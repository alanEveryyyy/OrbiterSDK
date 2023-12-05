import {
  AbiCoder,
  AbstractProvider,
  AddressLike,
  BigNumberish,
  PerformActionRequest,
  Provider,
  Signer,
  ethers,
} from "ethers-6";
import { Coin_ABI } from "./constant/common";
import { IChainInfo, ICrossRule } from "./types";
import BigNumber from "bignumber.js";

export function equalsIgnoreCase(value1: string, value2: string): boolean {
  if (typeof value1 !== "string" || typeof value2 !== "string") {
    return false;
  }
  return value1.toUpperCase() === value2.toUpperCase();
}
export async function getRpcList(chainInfo: IChainInfo) {
  const rpcList = (chainInfo?.rpc || []).sort(function () {
    return 0.5 - Math.random();
  });
  return rpcList;
}

export async function translatePerform(
  provider: AbstractProvider,
  req: PerformActionRequest
): Promise<any> {
  switch (req.method) {
    case "broadcastTransaction":
      return await provider.broadcastTransaction(req.signedTransaction);
    case "call":
      return await provider.call(
        Object.assign({}, req.transaction, { blockTag: req.blockTag })
      );
    case "chainId":
      return (await provider.getNetwork()).chainId;
    case "estimateGas":
      return await provider.estimateGas(req.transaction);
    case "getBalance":
      return await provider.getBalance(req.address, req.blockTag);
    case "getBlock": {
      const block = "blockHash" in req ? req.blockHash : req.blockTag;
      return await provider.getBlock(block, req.includeTransactions);
    }
    case "getBlockNumber":
      return await provider.getBlockNumber();
    case "getCode":
      return await provider.getCode(req.address, req.blockTag);
    case "getGasPrice":
      return (await provider.getFeeData()).gasPrice;
    case "getLogs":
      return await provider.getLogs(req.filter);
    case "getStorage":
      return await provider.getStorage(req.address, req.position, req.blockTag);
    case "getTransaction":
      return await provider.getTransaction(req.hash);
    case "getTransactionCount":
      return await provider.getTransactionCount(req.address, req?.blockTag);
    case "getTransactionReceipt":
      return await provider.getTransactionReceipt(req.hash);
    case "getTransactionResult":
      return await provider.getTransactionResult(req.hash);
  }
}

export async function requestWeb3(
  chainInfo: IChainInfo,
  params: PerformActionRequest
): Promise<any> {
  const rpcList = await getRpcList(chainInfo);
  return new Promise(async (resolve, reject) => {
    let result;
    if (rpcList && rpcList.length > 0) {
      for (const url of rpcList) {
        if (!url || url === "") {
          continue;
        }
        try {
          const provider = new ethers.AbstractProvider(url);
          result = await translatePerform(provider, params);
          resolve(result);
          break;
        } catch (error: unknown) {
          console.error(
            "request rpc error:",
            url,
            error,
            chainInfo.chainId,
            params.method,
            JSON.stringify(params)
          );
        }
      }
    }
    if (!result) {
      reject(
        `Reuqest RPC ERROR：${chainId}-${method}-${JSON.stringify(params)}`
      );
    }
  });
}

export function getContract(
  contractAddress: string,
  localChainID?: number | string,
  ABI?: any[]
) {
  if (localChainID === 3 || localChainID === 33) {
    return;
  }
  if (localChainID === 4 || localChainID === 44) {
    return;
  }
  const ecourseContractInstance = new ethers.Contract(
    contractAddress,
    ABI ? ABI : Coin_ABI
  );
  if (!ecourseContractInstance) {
    return null;
  }
  return ecourseContractInstance;
}

export function isEthTokenAddress(tokenAddress: string, chainInfo: IChainInfo) {
  if (chainInfo) {
    // main coin
    if (equalsIgnoreCase(chainInfo.nativeCurrency?.address, tokenAddress)) {
      return true;
    }
    // ERC20
    if (
      chainInfo.tokens.find((item) =>
        equalsIgnoreCase(item.address, tokenAddress)
      )
    ) {
      return false;
    }
  }
  return /^0x0+$/i.test(tokenAddress);
}

export async function getTransferGasLimit(
  signer: Signer,
  selectMakerConfig: ICrossRule,
  from: AddressLike,
  to: AddressLike,
  chainInfo: IChainInfo,
  value: number | string | BigNumberish
) {
  const tokenAddress = selectMakerConfig?.fromChain?.tokenAddress;
  let gasLimit = 55000n;
  try {
    if (isEthTokenAddress(tokenAddress, chainInfo)) {
      gasLimit = await signer.estimateGas({
        from,
        to: selectMakerConfig?.recipient,
        value,
      });
      return gasLimit;
    } else {
      const ecourseContractInstance = getContract(tokenAddress);
      if (!ecourseContractInstance) {
        return gasLimit;
      }

      gasLimit = await ecourseContractInstance.estimateGas({
        to,
        value,
        from,
      });
      return gasLimit;
    }
  } catch (err) {
    console.warn("getTransferGasLimit error: ", err);
  }

  return gasLimit;
}

export function getRealTransferValue(
  selectMakerConfig: ICrossRule,
  transferValue: number | string
): BigInt {
  if (!Object.keys(selectMakerConfig).length) {
    throw new Error(
      "get real transfer value failed, selectMakerConfig can not be empty!"
    );
  }
  return BigInt(
    new BigNumber(transferValue)
      .plus(new BigNumber(selectMakerConfig.tradingFee))
      .multipliedBy(new BigNumber(10 ** selectMakerConfig.fromChain.decimals))
      .toFixed()
  );
}
