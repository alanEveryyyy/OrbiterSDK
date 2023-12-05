import { Provider, Signer, Wallet, ethers } from "ethers-6";
import { beforeAll, describe, expect, test } from "vitest";
import ChainsService from "../services/ChainsService";
import OBridge from "../bridge";

describe("bridge tests", () => {
  // add your private key to the environment to be able to run the tests
  const PRIVATE_KEY = "";

  let signer: Signer;
  let bridge: OBridge;
  let provider: Provider;
  let owner: string;
  let chainsService: ChainsService;

  beforeAll(async () => {
    if (!PRIVATE_KEY)
      throw new Error(
        "private key can not be empty, pls add your private to the environment to be able to run the tests"
      );
    chainsService = new ChainsService();
    const goerliRpcs = await chainsService.getChainInfoAsync(5);
    const goerliProvider = new ethers.JsonRpcProvider(goerliRpcs?.rpc?.[0]);
    provider = goerliProvider;
    signer = new Wallet(PRIVATE_KEY, goerliProvider);
    bridge = new OBridge({
      signer,
    });
    owner = await signer.getAddress();
  });

  // xvm transfer by different address or different token
  test("xvm ETH transfer test", async () => {
    const xvmTransferConfig = {
      fromChainID: "5",
      fromCurrency: "ETH",
      toChainID: "420",
      toCurrency: "ETH",
      transferValue: 0.001,
      // add crossAddressReceipt: owner For test xvm
      crossAddressReceipt: owner,
    };
    const tx = await bridge.toBridge(xvmTransferConfig);
    console.log(tx);
    expect(tx.hash).toBeDefined;
  });

  test("evm ETH transfer test", async () => {
    const xvmTransferConfig = {
      fromChainID: "5",
      fromCurrency: "ETH",
      toChainID: "420",
      toCurrency: "ETH",
      transferValue: 0.001,
    };
    const tx = await bridge.toBridge(xvmTransferConfig);
    console.log(tx);
    expect(tx.hash).toBeDefined;
  });

  test.only("zksync lite ETH transfer test", async () => {
    const zksyncTransferConfig = {
      fromChainID: "zksync_test",
      fromCurrency: "ETH",
      toChainID: "420",
      toCurrency: "ETH",
      transferValue: 0.001,
    };
    const tx = await bridge.toBridge(zksyncTransferConfig);
    console.log(tx.txHash);
    expect(tx.txHash).toBeDefined;
  });
});
