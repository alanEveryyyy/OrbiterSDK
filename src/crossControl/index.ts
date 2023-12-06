import { Signer } from "ethers-6";
import ethers from "ethers";
import { submitSignedTransactionsBatch, utils, Wallet } from "zksync";
import { CrossAddress } from "../crossAddress/crossAddress";
import { XVMSwap } from "./xvm";
import loopring from "./loopring";
import zkspace from "./zkspace";
import {
  getTransferValue,
  getZkSyncProvider,
  isExecuteXVMContract,
} from "../bridge/utils";
import {
  getContract,
  getContractByType,
  getRealTransferValue,
  getRpcList,
  getTransferGasLimit,
  isEthTokenAddress,
  throwNewError,
} from "../utils";
import { ICrossFunctionParams, TCrossConfig } from "../types";
import {
  CHAIN_ID_MAINNET,
  CHAIN_ID_TESTNET,
  CONTRACT_OLD_TYPE,
} from "../constant/common";
import BigNumber from "bignumber.js";
import { ERC20TokenType, ETHTokenType } from "@imtbl/imx-sdk";
import { IMXHelper } from "./imx_helper";
import Web3 from "web3";
import { DydxHelper } from "./dydx_helper";
import {
  getAccountAddressError,
  sendTransfer,
  starknetHashFormat,
} from "./starknet_helper";

export default class CrossControl {
  private static instance: CrossControl;
  private crossConfig: TCrossConfig = {} as TCrossConfig;
  private signer: Signer = null as unknown as Signer;

  constructor() {}

  public static getInstance(): CrossControl {
    if (!this.instance) {
      this.instance = new CrossControl();
    }

    return this.instance;
  }

  private async initCrossFunctionConfig(
    signer: Signer,
    crossParams: ICrossFunctionParams
  ) {
    this.signer = signer;
    const {
      fromChainID,
      toChainID,
      selectMakerConfig,
      fromChainInfo,
      toChainInfo,
      transferValue,
    } = crossParams;
    const tokenAddress = selectMakerConfig?.fromChain?.tokenAddress;
    const to = selectMakerConfig?.recipient;
    const isETH = isEthTokenAddress(tokenAddress, fromChainInfo);
    try {
      const tValue = getTransferValue({
        fromChainInfo,
        toChainInfo,
        toChainID,
        fromChainID,
        transferValue,
        tradingFee: selectMakerConfig!.tradingFee,
        decimals: selectMakerConfig!.fromChain.decimals,
        selectMakerConfig,
      });

      if (!tValue.state) throwNewError("get transfer value error.");
      this.crossConfig = {
        ...crossParams,
        tokenAddress,
        isETH,
        to,
        tValue,
        account: await signer.getAddress(),
      };
    } catch (error) {
      throwNewError("init cross config error.", error);
    }
  }

  public async getCrossFunction(
    signer: Signer,
    crossParams: ICrossFunctionParams
  ) {
    await this.initCrossFunctionConfig(signer, crossParams);
    const {
      fromChainID,
      toChainID,
      fromChainInfo,
      fromCurrency,
      toCurrency,
      crossAddressReceipt,
    } = this.crossConfig;
    if (
      isExecuteXVMContract({
        fromChainID,
        fromChainInfo,
        toChainID,
        fromCurrency,
        toCurrency,
        crossAddressReceipt,
      })
    ) {
      return await this.xvmTransfer();
    }
    switch (fromChainID) {
      case CHAIN_ID_MAINNET.zksync:
      case CHAIN_ID_TESTNET.zksync_test:
        return await this.zkTransfer();
      // case CHAIN_ID_MAINNET.loopring:
      // case CHAIN_ID_TESTNET.loopring_test:
      // return await this.loopringTransfer();
      // case CHAIN_ID_MAINNET.zkspace:
      // case CHAIN_ID_TESTNET.zkspace_test:
      // return await this.zkspaceTransfer();
      case CHAIN_ID_MAINNET.starknet:
      case CHAIN_ID_TESTNET.starknet_test:
        return await this.starknetTransfer();
      case CHAIN_ID_MAINNET.imx:
      case CHAIN_ID_TESTNET.imx_test:
        return await this.imxTransfer();
      case CHAIN_ID_MAINNET.dydx:
      case CHAIN_ID_TESTNET.dydx_test:
        return await this.dydxTransfer();

      default: {
        if (
          toChainID === CHAIN_ID_MAINNET.starknet ||
          toChainID === CHAIN_ID_TESTNET.starknet_test
        ) {
          return await this.transferToStarkNet();
        }
        return await this.evmTransfer();
      }
    }
  }

  private async xvmTransfer(): Promise<any> {
    const {
      fromChainID,
      fromChainInfo,
      crossAddressReceipt,
      transferValue,
      selectMakerConfig,
      account,
      isETH,
    } = this.crossConfig;

    const amount = getRealTransferValue(selectMakerConfig, transferValue);
    const contractAddress = fromChainInfo?.xvmList?.[0];
    const tokenAddress = selectMakerConfig.fromChain.tokenAddress;
    if (!isETH) {
      const crossAddress = new CrossAddress(
        this.signer.provider,
        fromChainID,
        this.signer,
        contractAddress
      );
      await crossAddress.contractApprove(
        tokenAddress,
        new BigNumber(amount),
        contractAddress
      );
    }
    try {
      const tx = await XVMSwap(
        this.signer,
        contractAddress,
        account,
        selectMakerConfig,
        new BigNumber(amount),
        crossAddressReceipt ?? account,
        fromChainID,
        transferValue
      );
      return tx;
    } catch (error) {
      throwNewError("XVM transfer error", error);
    }
  }

  private async evmTransfer() {
    const {
      fromChainID,
      fromChainInfo,
      selectMakerConfig,
      tokenAddress,
      to,
      account,
      tValue,
      isETH,
    } = this.crossConfig;

    let gasLimit = await getTransferGasLimit(
      this.signer,
      selectMakerConfig,
      account,
      selectMakerConfig?.recipient,
      fromChainInfo,
      tValue?.tAmount
    );
    if (Number(fromChainID) === 2 && gasLimit < 21000) {
      gasLimit = 21000n;
    }
    if (isETH) {
      const tx = await this.signer.sendTransaction({
        from: account,
        to: selectMakerConfig?.recipient,
        value: tValue?.tAmount,
        gasLimit,
      });
      return tx;
    } else {
      const transferContract = getContract(tokenAddress, fromChainID);
      if (!transferContract) {
        return throwNewError(
          "Failed to obtain contract information, please refresh and try again."
        );
      }
      const objOption = { from: account, gas: gasLimit };
      try {
        const transferResult = await transferContract.transfer(
          to,
          tValue?.tAmount
        );
        await transferResult.wait();
        return await transferContract.send(objOption);
      } catch (error) {
        return throwNewError("evm transfer error", error);
      }
    }
  }
  private async zkTransfer() {
    const { selectMakerConfig, fromChainID, tValue } = this.crossConfig;
    const tokenAddress = selectMakerConfig.fromChain.tokenAddress;
    const syncProvider = await getZkSyncProvider(fromChainID);
    // @ts-ignore
    const syncWallet = await Wallet.fromEthSigner(this.signer, syncProvider);
    if (!syncWallet.signer)
      return throwNewError("zksync get sync wallet signer error.");
    const amount = utils.closestPackableTransactionAmount(tValue.tAmount);
    const transferFee = await syncProvider.getTransactionFee(
      "Transfer",
      syncWallet.address() || "",
      tokenAddress
    );
    if (!(await syncWallet.isSigningKeySet())) {
      const nonce = await syncWallet.getNonce("committed");
      const batchBuilder = syncWallet.batchBuilder(nonce);
      if (syncWallet.ethSignerType?.verificationMethod === "ERC-1271") {
        const isOnchainAuthSigningKeySet =
          await syncWallet.isOnchainAuthSigningKeySet();
        if (!isOnchainAuthSigningKeySet) {
          const onchainAuthTransaction =
            await syncWallet.onchainAuthSigningKey();
          await onchainAuthTransaction?.wait();
        }
      }
      const newPubKeyHash = (await syncWallet.signer.pubKeyHash()) || "";
      const accountID = await syncWallet.getAccountId();
      if (typeof accountID !== "number") {
        return throwNewError(
          "It is required to have a history of balances on the account to activate it."
        );
      }
      const changePubKeyMessage = utils.getChangePubkeyLegacyMessage(
        newPubKeyHash,
        nonce,
        accountID
      );
      const ethSignature = (
        await syncWallet.getEthMessageSignature(changePubKeyMessage)
      ).signature;
      const keyFee = await syncProvider.getTransactionFee(
        {
          ChangePubKey: { onchainPubkeyAuth: false },
        },
        syncWallet.address() || "",
        tokenAddress
      );

      const changePubKeyTx = await syncWallet.signer.signSyncChangePubKey({
        accountId: accountID,
        account: syncWallet.address(),
        newPkHash: newPubKeyHash,
        nonce,
        ethSignature,
        validFrom: 0,
        validUntil: utils.MAX_TIMESTAMP,
        fee: keyFee.totalFee,
        feeTokenId: syncWallet.provider.tokenSet.resolveTokenId(tokenAddress),
      });
      batchBuilder.addChangePubKey({
        tx: changePubKeyTx,
        // @ts-ignore
        alreadySigned: true,
      });
      batchBuilder.addTransfer({
        to: selectMakerConfig.recipient,
        token: tokenAddress,
        amount,
        fee: transferFee.totalFee,
      });
      const batchTransactionData = await batchBuilder.build();
      const transactions = await submitSignedTransactionsBatch(
        syncWallet.provider,
        batchTransactionData.txs,
        [batchTransactionData.signature]
      );
      let transaction;
      for (const tx of transactions) {
        if (tx.txData.tx.type !== "ChangePubKey") {
          transaction = tx;
          break;
        }
      }
      return transaction;
    } else {
      try {
        return await syncWallet.syncTransfer({
          to: selectMakerConfig.recipient,
          token: tokenAddress,
          amount,
        });
      } catch (error) {
        return throwNewError("sync wallet syncTransfer was wrong", error);
      }
    }
  }

  // private async loopringTransfer() {
  //   const {
  //     selectMakerConfig,
  //     crossAddressReceipt,
  //     fromChainID,
  //     tValue,
  //     tokenAddress,
  //     fromChainInfo,
  //     toChainInfo,
  //     account,
  //   } = this.crossConfig;
  //   const p_text = 9000 + Number(toChainInfo.internalId) + "";
  //   const amount = tValue.tAmount;
  //   const memo = crossAddressReceipt
  //     ? `${p_text}_${crossAddressReceipt}`
  //     : p_text;
  //   if (memo.length > 128)
  //     return throwNewError("The sending address is too long");
  //   try {
  //     return await loopring.sendTransfer(
  //       account,
  //       fromChainID,
  //       fromChainInfo,
  //       selectMakerConfig.recipient,
  //       tokenAddress,
  //       amount,
  //       memo
  //     );
  //   } catch (error) {
  //     const errorEnum = {
  //       "account is not activated":
  //         "This Loopring account is not yet activated, please activate it before transferring.",
  //       "User account is frozen":
  //         "Your Loopring account is frozen, please check your Loopring account status on Loopring website. Get more details here: https://docs.loopring.io/en/basics/key_mgmt.html?h=frozen",
  //       default: error.message,
  //     };
  //     return throwNewError(
  //       errorEnum[error.message as keyof typeof errorEnum] ||
  //         errorEnum.default ||
  //         "Something was wrong by loopring transfer. please check it all"
  //     );
  //   }
  // }

  // private async zkspaceTransfer() {
  //   const { selectMakerConfig, fromChainID, account, tValue } =
  //     this.crossConfig;
  //   try {
  //     const walletAccount = account;
  //     const privateKey = await zkspace.getL1SigAndPriVateKey(this.signer);
  //     const transferValue = utils.closestPackableTransactionAmount(
  //       tValue.tAmount
  //     );

  //     const accountInfo = await zkspace.getAccountInfo(
  //       fromChainID,
  //       privateKey,
  //       this.signer,
  //       walletAccount
  //     );
  //     const feeTokenId = 0;
  //     const zksNetWorkID = fromChainID === CHAIN_ID_MAINNET.zkspace ? 13 : 129;

  //     const fee = await zkspace.getZKSpaceTransferGasFee(
  //       fromChainID,
  //       walletAccount
  //     );

  //     const transferFee = utils.closestPackableTransactionFee(
  //       ethers.utils.parseUnits(fee.toString(), 18)
  //     );

  //     const getZksTokenID = fromChainID === CHAIN_ID_MAINNET.zkspace ? 12 : 512;

  //     const zksTokenInfos = await zkspace.getAllZksTokenList(getZksTokenID);
  //     const tokenAddress = selectMakerConfig.toChain.tokenAddress;
  //     const tokenInfo = zksTokenInfos.find(
  //       (item: any) => item.address === tokenAddress
  //     );
  //     const { pubKey, l2SignatureOne } = zkspace.getL2SigOneAndPK(
  //       privateKey,
  //       accountInfo,
  //       walletAccount,
  //       tokenInfo ? tokenInfo.id : 0,
  //       transferValue,
  //       feeTokenId,
  //       transferFee,
  //       zksNetWorkID,
  //       selectMakerConfig
  //     );

  //     const l2SignatureTwo = await zkspace.getL2SigTwoAndPK(
  //       this.signer,
  //       accountInfo,
  //       transferValue,
  //       fee,
  //       zksNetWorkID,
  //       tokenInfo,
  //       selectMakerConfig
  //     );
  //     const req = {
  //       signature: {
  //         type: "EthereumSignature",
  //         signature: l2SignatureTwo,
  //       },
  //       fastProcessing: false,
  //       tx: {
  //         type: "Transfer",
  //         accountId: accountInfo.id,
  //         from: walletAccount,
  //         to: selectMakerConfig.recipient,
  //         token: tokenInfo ? tokenInfo.id : 0,
  //         amount: transferValue.toString(),
  //         feeToken: feeTokenId,
  //         fee: transferFee.toString(),
  //         chainId: zksNetWorkID,
  //         nonce: accountInfo.nonce,
  //         signature: {
  //           pubKey,
  //           signature: l2SignatureOne,
  //         },
  //       },
  //     };

  //     const transferResult = await zkspace.sendTransfer(fromChainID, req);
  //     const txHash = transferResult?.data?.data.replace("sync-tx:", "0x");
  //     return {
  //       ...transferResult,
  //       getTransferResult: zkspace.getFristResult(fromChainID, txHash),
  //     };
  //   } catch (error: any) {
  //     throwNewError("zkspace Transfer error", error);
  //   }
  // }
  private async starknetTransfer() {
    const {
      selectMakerConfig,
      fromChainID,
      toChainID,
      account,
      crossAddressReceipt,
      fromChainInfo,
      tValue,
    } = this.crossConfig;
    if (
      !account ||
      !new RegExp(/^0x[a-fA-F0-9]{40}$/).test(account) ||
      account === "0x0000000000000000000000000000000000000000"
    ) {
      return throwNewError("Please connect correct evm wallet address");
    }
    if (selectMakerConfig.recipient.length < 60) {
      return;
    }
    try {
      const contractAddress = selectMakerConfig.fromChain.tokenAddress;
      return await sendTransfer(
        account,
        contractAddress,
        selectMakerConfig.recipient,
        new BigNumber(tValue.tAmount),
        fromChainID,
        fromChainInfo
      );
    } catch (error) {
      return throwNewError("starknet transfer error", error);
    }
  }

  private async transferToStarkNet() {
    const {
      selectMakerConfig,
      fromChainID,
      transferExt,
      tValue,
      fromChainInfo,
      isETH,
    } = this.crossConfig;

    const contractAddress = selectMakerConfig.fromChain.tokenAddress;
    const recipient = selectMakerConfig.recipient;
    const amount = tValue.tAmount;
    if (
      !transferExt?.receiveStarknetAddress ||
      starknetHashFormat(transferExt.receiveStarknetAddress).length !== 66 ||
      starknetHashFormat(transferExt.receiveStarknetAddress) ===
        "0x0000000000000000000000000000000000000000000000000000000000000000"
    ) {
      return throwNewError("please connect correct starknet wallet address");
    }
    const error = getAccountAddressError(
      transferExt.receiveStarknetAddress,
      true
    );
    if (error) {
      return throwNewError(`starknet get account address error: ${error}`);
    }
    const contractByType =
      fromChainInfo.contract &&
      getContractByType(fromChainInfo.contract, CONTRACT_OLD_TYPE);
    if (!fromChainInfo.contract || !contractByType) {
      return throwNewError("Contract not in fromChainInfo.");
    }
    const crossContractAddress = contractByType;
    try {
      const provider = this.signer.provider;
      const crossAddress = new CrossAddress(
        provider,
        fromChainID,
        this.signer,
        crossContractAddress
      );
      if (isETH) {
        return await crossAddress.transfer(recipient, amount, transferExt);
      } else {
        return await crossAddress.transferERC20(
          contractAddress,
          recipient,
          new BigNumber(amount),
          transferExt
        );
      }
    } catch (err) {
      return throwNewError("transfer to starknet error", err);
    }
  }
  private async imxTransfer() {
    const {
      selectMakerConfig,
      fromChainID,
      account,
      fromChainInfo,
      tValue,
      isETH,
    } = this.crossConfig;
    try {
      const contractAddress = selectMakerConfig.fromChain.tokenAddress;

      const imxHelper = new IMXHelper(fromChainID);
      const imxClient = await imxHelper.getImmutableXClient(
        this.signer,
        account,
        true
      );

      let tokenInfo: {
        type: ETHTokenType | ERC20TokenType | any;
        data: {
          symbol?: string;
          decimals: number;
          tokenAddress?: string;
        };
      } = {
        type: ETHTokenType.ETH,
        data: {
          decimals: selectMakerConfig.fromChain.decimals,
        },
      };
      if (!isETH) {
        tokenInfo = {
          type: ERC20TokenType.ERC20,
          data: {
            symbol: selectMakerConfig.fromChain.symbol,
            decimals: selectMakerConfig.fromChain.decimals,
            tokenAddress: contractAddress,
          },
        };
      }
      return await imxClient.transfer({
        sender: account,
        token: tokenInfo,
        quantity: ethers.BigNumber.from(tValue.tAmount),
        receiver: selectMakerConfig.recipient,
      });
    } catch (error: any) {
      throw new Error(`Imx transfer error: ${error.message}`);
    }
  }

  private async dydxTransfer() {
    const { selectMakerConfig, fromChainID, fromChainInfo, account, tValue } =
      this.crossConfig;
    const dydxRpcs = await getRpcList(fromChainInfo);
    try {
      const dydxHelper = new DydxHelper(
        fromChainID,
        new Web3(dydxRpcs[0]),
        "TypedData"
      );
      const dydxMakerInfo = dydxHelper.getMakerInfo(
        selectMakerConfig.recipient
      );
      const dydxClient = await dydxHelper.getDydxClient(account, false, true);
      const dydxAccount = await dydxHelper.getAccount(account);

      const params = {
        clientId: dydxHelper.generateClientId(account),
        amount: new BigNumber(tValue.tAmount).dividedBy(10 ** 6).toString(), // Only usdc
        expiration: new Date(
          new Date().getTime() + 86400000 * 30
        ).toISOString(),
        receiverAccountId: dydxHelper.getAccountId(selectMakerConfig.recipient),
        receiverPublicKey: dydxMakerInfo.starkKey,
        receiverPositionId: String(dydxMakerInfo.positionId),
      };
      return await dydxClient.private.createTransfer(
        params,
        dydxAccount.positionId
      );
    } catch (error: any) {
      throwNewError("dydx transfer error", error);
    }
  }
}
