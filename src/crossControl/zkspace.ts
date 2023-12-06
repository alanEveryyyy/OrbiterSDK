import axios from "axios";
import * as ethers from "ethers";
import * as zksync from "zksync";
import { private_key_to_pubkey_hash, sign_musig } from "zksync-crypto";
import config from "../constant/config";
import { CHAIN_ID_MAINNET, CHAIN_ID_TESTNET } from "../constant/common";
import BigNumber from "bignumber.js";
import tunnel from "tunnel";
import { getZKSTokenList } from "../services/ApiService";
import { getTokenConvertUsd, sleep } from "../utils";
import { Signer } from "ethers-6";
import { ICrossRule } from "../types";

axios.defaults.proxy = false;
axios.defaults.httpsAgent = tunnel.httpsOverHttp({
  proxy: { host: "127.0.0.1", port: "7890" },
});

export default {
  getZKSpaceTransferGasFee: async function (
    fromChainID: string,
    account: string
  ) {
    if (!account) {
      return 0;
    }
    const ethPrice = (await getTokenConvertUsd("ETH")) || 2000;

    if (
      fromChainID !== CHAIN_ID_MAINNET.zkspace &&
      fromChainID !== CHAIN_ID_TESTNET.zkspace_test
    ) {
      throw new Error("getZKSpaceTransferGasFee：wrongChainID");
    }
    const url = `${
      fromChainID === CHAIN_ID_TESTNET.zkspace_test
        ? config.ZKSpace.Rinkeby
        : config.ZKSpace.Mainnet
    }/account/${account}/fee`;
    try {
      const response = await axios.get(url);
      if (response.status === 200) {
        const respData = response.data;
        if (respData.success === true) {
          const gasFee = new BigNumber(respData.data.transfer).dividedBy(
            new BigNumber(ethPrice)
          );
          const gasFee_fix = gasFee.decimalPlaces(6, BigNumber.ROUND_UP);
          return Number(gasFee_fix);
        } else {
          throw new Error("getZKSpaceGasFee->respData.success no true");
        }
      } else {
        throw new Error("getZKSpaceGasFee->response.status not 200");
      }
    } catch (error) {
      throw new Error("getZKSpaceGasFee->network error");
    }
  },
  getZKAccountInfo: function (fromChainID: string, account: string) {
    return new Promise((resolve, reject) => {
      if (
        fromChainID !== CHAIN_ID_MAINNET.zkspace &&
        fromChainID !== CHAIN_ID_TESTNET.zkspace_test
      ) {
        reject({
          errorCode: 1,
          errMsg: "getZKSpaceAccountInfoError_wrongChainID",
        });
      }
      const url =
        (fromChainID === CHAIN_ID_TESTNET.zkspace_test
          ? config.ZKSpace.Rinkeby
          : config.ZKSpace.Mainnet) +
        "/account/" +
        account +
        "/" +
        "info";
      axios
        .get(url)
        .then(function (response) {
          if (response.status === 200) {
            const respData = response.data;
            if (respData.success == true) {
              resolve(respData.data);
            } else {
              reject(respData.data);
            }
          } else {
            reject({
              errorCode: 1,
              errMsg: "NetWorkError",
            });
          }
        })
        .catch(function (error) {
          reject({
            errorCode: 2,
            errMsg: error,
          });
        });
    });
  },
  sendTransfer: async function (fromChainID: string, params) {
    if (
      fromChainID !== CHAIN_ID_MAINNET.zkspace &&
      fromChainID !== CHAIN_ID_TESTNET.zkspace_test
    ) {
      return {
        code: "1",
        error: "sendZKSpaceTransferError_wrongChainID",
      };
    }
    const response = await axios.post(
      (fromChainID === CHAIN_ID_TESTNET.zkspace_test
        ? config.ZKSpace.Rinkeby
        : config.ZKSpace.Mainnet) + "/tx",
      {
        signature: params.signature,
        fastProcessing: params.fastProcessing,
        tx: params.tx,
      }
    );
    return response;
  },
  async getL2SigTwoAndPK(
    signer: Signer,
    accountInfo,
    transferValue,
    fee: number,
    zksChainID: 13 | 129,
    tokenInfo,
    selectMakerConfig: ICrossRule
  ) {
    try {
      const l2MsgParams = {
        accountId: accountInfo.id,
        to: selectMakerConfig.recipient,
        tokenSymbol: tokenInfo ? tokenInfo.symbol : "ETH",
        tokenAmount: ethers.utils.formatUnits(
          transferValue,
          tokenInfo.decimals
        ),
        feeSymbol: "ETH",
        fee: fee.toString(),
        zksChainID,
        nonce: accountInfo.nonce,
      };
      const l2Msg =
        `Transfer ${l2MsgParams.tokenAmount} ${l2MsgParams.tokenSymbol}\n` +
        `To: ${l2MsgParams.to.toLowerCase()}\n` +
        `Chain Id: ${l2MsgParams.zksChainID}\n` +
        `Nonce: ${l2MsgParams.nonce}\n` +
        `Fee: ${l2MsgParams.fee} ${l2MsgParams.feeSymbol}\n` +
        `Account Id: ${l2MsgParams.accountId}`;
      return await signer.signMessage(l2Msg);
    } catch (error: any) {
      throw new Error(`getL2SigTwoAndPK error ${error.message}`);
    }
  },
  getL2SigOneAndPK(
    privateKey: Uint8Array,
    accountInfo,
    walletAccount: string,
    tokenId: number,
    transferValue,
    feeTokenId: 0,
    transferFee,
    zksChainID: 13 | 129,
    selectMakerConfig: ICrossRule
  ) {
    const msgBytes = ethers.utils.concat([
      "0x05",
      zksync.utils.numberToBytesBE(accountInfo.id, 4),
      walletAccount,
      selectMakerConfig.recipient,
      zksync.utils.numberToBytesBE(Number(tokenId), 2),
      zksync.utils.packAmountChecked(transferValue),
      zksync.utils.numberToBytesBE(feeTokenId, 1),
      zksync.utils.packFeeChecked(transferFee),
      zksync.utils.numberToBytesBE(zksChainID, 1),
      zksync.utils.numberToBytesBE(accountInfo.nonce, 4),
    ]);
    const signaturePacked = sign_musig(privateKey, msgBytes);
    const pubKey = ethers.utils.hexlify(signaturePacked.slice(0, 32)).substr(2);
    const l2SignatureOne = ethers.utils
      .hexlify(signaturePacked.slice(32))
      .substr(2);
    return { pubKey, l2SignatureOne };
  },

  async getAccountInfo(fromChainID, privateKey, signer, walletAccount) {
    try {
      const accountInfo = await this.getZKAccountInfo(
        fromChainID,
        walletAccount
      );
      if (
        accountInfo.pub_key_hash ==
        "sync:0000000000000000000000000000000000000000"
      ) {
        const new_pub_key_hash = await this.registerAccount(
          accountInfo,
          privateKey,
          fromChainID,
          signer,
          walletAccount
        );
        accountInfo.pub_key_hash = new_pub_key_hash;
        accountInfo.nonce = accountInfo.nonce + 1;
      }
      return accountInfo;
    } catch (error: any) {
      throw new Error(`getAccountInfo error ${error.message}`);
    }
  },
  async getL1SigAndPriVateKey(signer: Signer) {
    try {
      const msg =
        "Access ZKSwap account.\n\nOnly sign this message for a trusted client!";
      const signature = await signer.signMessage(msg);
      const seed = ethers.utils.arrayify(signature);
      const privateKey = await zksync.crypto.privateKeyFromSeed(seed);
      return privateKey;
    } catch (error: any) {
      throw new Error(`getL1SigAndPriVateKey error ${error.message}`);
    }
  },
  async registerAccount(
    accountInfo,
    privateKey,
    fromChainID,
    signer,
    walletAccount
  ) {
    try {
      const pubKeyHash = ethers.utils
        .hexlify(private_key_to_pubkey_hash(privateKey))
        .substr(2);
      const hexlifiedAccountId = this.toHex(accountInfo.id, 4);
      const hexlifiedNonce = this.toHex(accountInfo.nonce, 4);

      // Don't move here any way and don't format it anyway!!!
      const resgiterMsg = `Register ZKSwap pubkey:

${pubKeyHash}
nonce: ${hexlifiedNonce}
account id: ${hexlifiedAccountId}

Only sign this message for a trusted client!`;

      const registerSignature = await signer.signMessage(resgiterMsg);
      const url = `${
        fromChainID == CHAIN_ID_TESTNET.zkspace_test
          ? config.ZKSpace.Rinkeby
          : config.ZKSpace.Mainnet
      }/tx`;
      const transferResult = await axios.post(
        url,
        {
          signature: null,
          fastProcessing: null,
          extraParams: null,
          tx: {
            account: walletAccount,
            accountId: accountInfo.id,
            ethSignature: registerSignature,
            newPkHash: "sync:" + pubKeyHash,
            nonce: 0,
            type: "ChangePubKey",
          },
        },
        {
          headers: {
            "zk-account": walletAccount,
          },
        }
      );
      if (transferResult.status == 200 && transferResult.data.success) {
        return transferResult.data;
      } else {
        throw new Error("registerAccount fail");
      }
    } catch (error) {
      throw new Error(`registerAccount error ${error.message}`);
    }
  },
  toHex(num: number, length: number) {
    const charArray = ["a", "b", "c", "d", "e", "f"];
    const strArr = Array(length * 2).fill("0");
    let i = length * 2 - 1;
    while (num > 15) {
      const yushu = num % 16;
      if (yushu >= 10) {
        const index = yushu % 10;
        strArr[i--] = charArray[index];
      } else {
        strArr[i--] = yushu.toString();
      }
      num = Math.floor(num / 16);
    }

    if (num != 0) {
      if (num >= 10) {
        const index = num % 10;
        strArr[i--] = charArray[index];
      } else {
        strArr[i--] = num.toString();
      }
    }
    strArr.unshift("0x");
    const hex = strArr.join("");
    return hex;
  },
  async getAllZksTokenList(localChainID: number) {
    if (localChainID !== 12 && localChainID !== 512) {
      return;
    }
    let isContiue = true;
    let startID = 0;
    let zksTokenAllList: any = [];
    try {
      while (isContiue) {
        const zksTokenListReq = {
          from: startID,
          limit: 100,
          direction: "newer",
          fromChainID: localChainID,
        };
        const zksList = await getZKSTokenList(zksTokenListReq);
        if (zksList.length !== 100) {
          isContiue = false;
        } else {
          startID = zksList[99].id + 1;
        }
        zksTokenAllList = zksTokenAllList.concat(zksList);
      }
      return zksTokenAllList;
    } catch (error: any) {
      throw new Error(`zk_TokenListGetError = ${error.message}`);
    }
  },
  async getZKSpaceTransactionData(localChainID: string, txHash: string) {
    if (
      localChainID !== CHAIN_ID_MAINNET.zkspace &&
      localChainID !== CHAIN_ID_TESTNET.zkspace_test
    ) {
      throw new Error("getZKTransactionDataError_wrongChainID");
    }
    const url =
      (localChainID === CHAIN_ID_TESTNET.zkspace_test
        ? config.ZKSpace.Rinkeby
        : config.ZKSpace.Mainnet) +
      "/tx/" +
      txHash;
    const response = await axios.get(url);

    if (response.status === 200) {
      const respData = response.data;
      if (respData.success === true) {
        return respData;
      } else {
        throw new Error(respData);
      }
    } else {
      throw new Error("getZKSpaceTransactionData NetWorkError");
    }
  },
  async getFristResult(fromChainID: string, txHash: string): Promise<any> {
    const firstResult = await this.getZKSpaceTransactionData(
      fromChainID,
      txHash
    );
    if (
      firstResult.success &&
      !firstResult.data.fail_reason &&
      !firstResult.data.success &&
      !firstResult.data.amount
    ) {
      await sleep(300);
      return await this.getFristResult(fromChainID, txHash);
    } else if (
      firstResult.success &&
      !firstResult.data.fail_reason &&
      firstResult.data.success &&
      firstResult.data.amount
    ) {
      return firstResult;
    } else {
      throw new Error("zks sendResult is error");
    }
  },
};
