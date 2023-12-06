import { AccountResponseObject, DydxClient } from "@dydxprotocol/v3-client";
import { getAccountId } from "@dydxprotocol/v3-client/build/src/lib/db";
import { ethers } from "ethers";
import config from "../constant/config";
// import util from '../util'
import {
  CHAIN_ID_MAINNET,
  CHAIN_ID_TESTNET,
  DYDX_MAKERS,
} from "../constant/common";
import { throwNewError } from "../utils";

const DYDX_CLIENTS: {
  [K: string]: DydxClient;
} = {};
const DYDX_ACCOUNTS: {
  [k: string]: AccountResponseObject;
} = {};

export class DydxHelper {
  chainId = "";
  networkId = 0;
  host = "";
  web3;
  signingMethod = "";

  constructor(chainId: string, web3: any, signingMethod = "TypedData") {
    if (chainId === CHAIN_ID_MAINNET.dydx) {
      this.networkId = 1;
      this.host = config.dydx.Mainnet;
    }
    if (chainId === CHAIN_ID_TESTNET.dydx_test) {
      this.networkId = 3;
      this.host = config.dydx.Rinkeby;
    }

    this.chainId = chainId;
    this.web3 = web3;
    this.signingMethod = signingMethod;
  }

  /**
   * @param {string} ethereumAddress
   * @param {boolean} alwaysNew
   * @param {boolean} alwaysDeriveStarkKey
   * @returns {Promise<DydxClient>}
   */
  async getDydxClient(
    ethereumAddress: string,
    alwaysNew?: boolean,
    alwaysDeriveStarkKey?: boolean
  ): Promise<DydxClient> {
    const dydxClientKey = ethereumAddress.toLowerCase();
    const clientOld = DYDX_CLIENTS[dydxClientKey as keyof typeof DYDX_CLIENTS];

    if (clientOld && !alwaysNew) {
      if (alwaysDeriveStarkKey && ethereumAddress) {
        clientOld._private = null;

        clientOld.starkPrivateKey = await clientOld.onboarding.deriveStarkKey(
          ethereumAddress,
          this.signingMethod
        );
      }

      return clientOld;
    }

    if (!this.host) {
      throw new Error("Sorry, miss param [host]");
    }
    // Ensure network
    // if (!(await util.ensureWalletNetwork(this.chainId))) {
    //   throw new Error('Network error')
    // }
    const client = new DydxClient(this.host, {
      networkId: this.networkId,
      web3: this.web3,
    });
    if (ethereumAddress && this.web3) {
      const userExists = await client.public.doesUserExistWithAddress(
        ethereumAddress
      );
      if (userExists.exists) {
        if (alwaysDeriveStarkKey) {
          client.starkPrivateKey = await client.onboarding.deriveStarkKey(
            ethereumAddress,
            this.signingMethod
          );
        }

        const apiCredentials =
          await client.onboarding.recoverDefaultApiCredentials(
            ethereumAddress,
            this.signingMethod
          );
        client.apiKeyCredentials = apiCredentials;
      } else {
        const keyPair = await client.onboarding.deriveStarkKey(
          ethereumAddress,
          this.signingMethod
        );
        client.starkPrivateKey = keyPair;

        const user = await client.onboarding.createUser(
          {
            starkKey: keyPair.publicKey,
            starkKeyYCoordinate: keyPair.publicKeyYCoordinate,
          },
          ethereumAddress,
          undefined,
          this.signingMethod
        );
        client.apiKeyCredentials = user.apiKey;
      }
    }

    return (DYDX_CLIENTS[dydxClientKey as keyof typeof DYDX_CLIENTS] = client);
  }

  async getBalanceUsdc(
    ethereumAddress: string,
    ensureUser: boolean = true
  ): Promise<ethers.BigNumber> {
    if (!ethereumAddress) {
      throwNewError("getBalanceUsdc error: Sorry, miss param [user]");
    }

    let balance = ethers.BigNumber.from(0);

    try {
      let dydxClient = DYDX_CLIENTS[ethereumAddress];
      if (ensureUser && !dydxClient) {
        dydxClient = await this.getDydxClient(ethereumAddress);
      }

      if (dydxClient) {
        const { account } = await dydxClient.private.getAccount(
          ethereumAddress
        );
        const usdc = parseInt(
          String((Number(account.freeCollateral) || 0) * 10 ** 6)
        );
        balance = balance.add(usdc);
      }
    } catch (err) {
      throwNewError("GetBalanceUsdc failed", err);
    }

    return balance;
  }

  async getAccount(
    ethereumAddress: string,
    alwaysNew?: boolean
  ): Promise<AccountResponseObject> {
    const dydxAccountKey = String(ethereumAddress);

    if (
      DYDX_ACCOUNTS[dydxAccountKey as keyof typeof DYDX_ACCOUNTS] &&
      !alwaysNew
    ) {
      return DYDX_ACCOUNTS[dydxAccountKey as keyof typeof DYDX_ACCOUNTS];
    }

    const dydxClient = await this.getDydxClient(ethereumAddress);
    const { account } = await dydxClient.private.getAccount(ethereumAddress);

    return (DYDX_ACCOUNTS[dydxAccountKey as keyof typeof DYDX_ACCOUNTS] =
      account);
  }

  getAccountId(ethereumAddress: string): string {
    return getAccountId({ address: ethereumAddress });
  }

  getMakerInfo(ethereumAddress: string): {
    starkKey: string;
    positionId: string;
  } {
    const info = DYDX_MAKERS[ethereumAddress as keyof typeof DYDX_MAKERS];
    if (!info) {
      throw new Error(`Sorry, miss DYDX_MAKERS: ${ethereumAddress}`);
    }
    return info;
  }

  generateClientId(ethereumAddress: string) {
    const time = new Date().getTime();
    const rand = parseInt(String(Math.random() * 899 + 100));
    let sourceStr = `${ethereumAddress}${time}${rand}`;
    if (sourceStr.length % 2 != 0) {
      sourceStr += "0";
    }
    sourceStr = sourceStr.replace(/^0x/i, "");

    return Buffer.from(sourceStr, "hex").toString("base64");
  }
}
