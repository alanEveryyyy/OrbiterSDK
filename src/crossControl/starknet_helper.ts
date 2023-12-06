import {
  Contract,
  RpcProvider,
  uint256,
  validateAndParseAddress,
} from "starknet";
import { STARKNET_ERC20_ABI, STARKNET_OB_SOURCE_ABI } from "../constant/abi";
import { getStarknet } from "get-starknet";
import {
  CHAIN_ID_MAINNET,
  CHAIN_ID_TESTNET,
  STARKNET_CROSS_CONTRACT_ADDRESS,
  UINT_256_MAX,
} from "../constant/common";
import { throwNewError } from "../utils";
import { IChainInfo } from "../types";

export async function sendTransfer(
  l1Address,
  tokenAddress,
  makerAddress,
  amount,
  fromChainID,
  fromChainInfo: IChainInfo
) {
  l1Address = l1Address.toLowerCase();
  tokenAddress = tokenAddress.toLowerCase();
  makerAddress = makerAddress.toLowerCase();
  const networkID = fromChainID === CHAIN_ID_MAINNET.starknet ? 1 : 5;
  const network = networkID === 1 ? "mainnet-alpha" : "goerli-alpha";
  const contractAddress = STARKNET_CROSS_CONTRACT_ADDRESS[network];

  if (!fromChainInfo?.rpc || !fromChainInfo.rpc.length) {
    throw new Error("starknet rpc not configured");
  }
  const provider = new RpcProvider({ nodeUrl: fromChainInfo.rpc[0] });
  const tokenContract = new Contract(
    STARKNET_ERC20_ABI,
    tokenAddress,
    provider
  );
  const allowance = await getAllowance(tokenContract, contractAddress);
  const crossContract = new Contract(
    STARKNET_OB_SOURCE_ABI,
    contractAddress,
    provider
  );
  const receiverAddress = makerAddress;

  try {
    let tx;
    if (amount.gt(allowance)) {
      const approveTxCall = tokenContract.populate("approve", [
        contractAddress,
        getUint256CalldataFromBN(String(UINT_256_MAX)),
      ]);
      const transferERC20TxCall = crossContract.populate("transferERC20", [
        tokenAddress,
        receiverAddress,
        getUint256CalldataFromBN(String(amount)),
        l1Address,
      ]);
      tx = await getStarknet().account.execute([
        approveTxCall,
        transferERC20TxCall,
      ]);
    } else {
      const transferERC20TxCall = crossContract.populate("transferERC20", [
        tokenAddress,
        receiverAddress,
        getUint256CalldataFromBN(String(amount)),
        l1Address,
      ]);
      tx = await getStarknet().account.execute(transferERC20TxCall);
    }
    return tx?.transaction_hash;
  } catch (e) {
    return throwNewError("starknet transfer error", e);
  }
}

export async function getAllowance(
  contractErc20: Contract,
  contractAddress: string
) {
  const ownerAddress = getStarknet().selectedAddress;
  const allowance = await contractErc20.allowance(
    ownerAddress,
    contractAddress
  );
  return allowance.remaining.low;
}

function getUint256CalldataFromBN(bn) {
  return { type: "struct", ...uint256.bnToUint256(bn) };
}

export function starknetHashFormat(txHash: string) {
  if (txHash.length < 66) {
    const end = txHash.substring(2, txHash.length);
    const add = 64 - end.length;
    let addStr = "";
    for (let i = 0; i < add; i++) {
      addStr += "0";
    }
    txHash = "0x" + addStr + end;
  }
  return txHash;
}

export function getAccountAddressError(address: string, isStarknet: boolean) {
  if (isStarknet) {
    try {
      validateAndParseAddress(starknetHashFormat(address));
      return null;
    } catch (e: any) {
      return e.message;
    }
  } else {
    if (new RegExp(/^0x[a-fA-F0-9]{40}$/).test(address)) {
      return null;
    } else {
      return "Invalid evm address";
    }
  }
}
