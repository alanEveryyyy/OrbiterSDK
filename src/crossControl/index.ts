import { Signer } from "ethers-6";
import {
  getTransferValue,
  getZkSyncProvider,
  isExecuteXVMContract,
} from "../bridge/utils";
import { ICrossFunctionParams, TCrossConfig } from "../types";
import {
  getContract,
  getRealTransferValue,
  getTransferGasLimit,
  isEthTokenAddress,
} from "../utils";
import { XVMSwap } from "./xvm";
import { CrossAddress } from "../crossAddress/crossAddress";
import { submitSignedTransactionsBatch, utils, Wallet } from "zksync";
import { CHAIN_ID_MAINNET, CHAIN_ID_TESTNET } from "../constant/common";

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
      if (!tValue.state) throw new Error(`get transfer value error.`);
      this.crossConfig = {
        ...crossParams,
        tokenAddress,
        to,
        tValue,
        account: await signer.getAddress(),
      };
    } catch (error: any) {
      throw new Error(error.message);
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
      console.log("by xvm~~~~~~~");
      return await this.handleXVMContract();
    }
    switch (fromChainID) {
      case CHAIN_ID_MAINNET.zksync:
      case CHAIN_ID_TESTNET.zksync_test:
        return await this.zkTransfer();
      case CHAIN_ID_MAINNET.loopring:
      case CHAIN_ID_TESTNET.loopring_test:
        return await this.loopringTransfer();
      case CHAIN_ID_MAINNET.zkspace:
      case CHAIN_ID_TESTNET.zkspace_test:
        return await this.zkspaceTransfer();
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
          return this.transferToStarkNet();
        }
        console.log("by evm~~~~~~~");
        return await this.evmTransfer();
      }
    }
  }

  private async handleXVMContract(): Promise<any> {
    const {
      fromChainID,
      fromChainInfo,
      crossAddressReceipt,
      transferValue,
      selectMakerConfig,
      account,
    } = this.crossConfig;

    const amount = getRealTransferValue(selectMakerConfig, transferValue);
    const contractAddress = fromChainInfo?.xvmList?.[0];
    const tokenAddress = selectMakerConfig.fromChain.tokenAddress;
    if (!isEthTokenAddress(tokenAddress, fromChainInfo)) {
      const crossAddress = new CrossAddress(
        this.signer.provider,
        fromChainID,
        this.signer,
        contractAddress
      );
      await crossAddress.contractApprove(tokenAddress, amount, contractAddress);
    }
    try {
      const tx = await XVMSwap(
        this.signer,
        contractAddress,
        account,
        selectMakerConfig,
        amount,
        crossAddressReceipt ?? account,
        fromChainID,
        transferValue
      );
      return tx;
    } catch (e) {
      console.error(e, "error");
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
    if (isEthTokenAddress(tokenAddress, fromChainInfo)) {
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
        throw new Error(
          "Failed to obtain contract information, please refresh and try again"
        );
      }
      const objOption = { from: account, gas: gasLimit };
      try {
        const transferResult = await transferContract.transfer(
          to,
          tValue?.tAmount
        );
        await transferResult.wait();
        await transferContract.send(objOption);
      } catch (error: unknown) {
        throw new Error(JSON.stringify(error));
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
      throw new Error("zksync get sync wallet signer error.");
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
        throw new TypeError(
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
      } catch (error: any) {
        throw new Error(`Something was wrong: ${error.message}`);
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
  //     toChainInfo,
  //     account,
  //   } = this.crossConfig;
  //   const p_text = 9000 + Number(toChainInfo.internalId) + "";
  //   const amount = tValue.tAmount;
  //   const memo = crossAddressReceipt
  //     ? `${p_text}_${crossAddressReceipt}`
  //     : p_text;
  //   if (memo.length > 128) throw new Error("The sending address is too long");
  //   try {
  //     const response = await loopring.sendTransfer(
  //       account,
  //       fromChainID,
  //       selectMakerConfig.recipient,
  //       0,
  //       tokenAddress,
  //       amount,
  //       memo
  //     );
  //   } catch (error: any) {
  //     const errorEnum = {
  //       "account is not activated":
  //         "This Loopring account is not yet activated, please activate it before transferring.",
  //       "User account is frozen":
  //         "Your Loopring account is frozen, please check your Loopring account status on Loopring website. Get more details here: https://docs.loopring.io/en/basics/key_mgmt.html?h=frozen",
  //       default: error.message,
  //     };
  //     throw new Error(
  //       errorEnum[error.message as keyof typeof errorEnum] ||
  //         errorEnum.default ||
  //         "Something was wrong by loopring transfer. please check it all"
  //     );
  //   }
  // }

  private async zkspaceTransfer() {}
  private async starknetTransfer() {}
  private async transferToStarkNet() {}
  private async imxTransfer() {}
  private async dydxTransfer() {}
}
