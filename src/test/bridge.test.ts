import { Provider, Signer, Wallet, ethers } from "ethers-6";
import { beforeAll, describe, expect, test } from "vitest";
import ChainsService from "../services/ChainsService";
import OBridge from "../bridge";

describe("bridge tests", () => {
  // add your private key to the environment to be able to run the tests
  const PRIVATE_KEY =
    "d5d5cbd1beef4c8717d76a49bfdc1d2fb5873eb08a6b41c9233983c18a833ec2";

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
    // const goerliRpcs = await chainsService.getChainInfoAsync(5);
    const goerliProvider = new ethers.JsonRpcProvider(
      "https://goerli.infura.io/v3/e41edd236d664caabcc0b486e4912069"
    );
    // const goerliProvider = new ethers.JsonRpcProvider(goerliRpcs?.rpc?.[0]);
    provider = goerliProvider;
    signer = new Wallet(PRIVATE_KEY, goerliProvider);
    bridge = new OBridge({
      signer,
    });
    owner = await signer.getAddress();
  });

  // xvm cross by different address or different token
  test("xvm ETH cross to op test", async () => {
    const xvmCrossConfig = {
      fromChainID: "5",
      fromCurrency: "ETH",
      toChainID: "420",
      toCurrency: "ETH",
      transferValue: 0.001,
      // add crossAddressReceipt: owner For test xvm
      crossAddressReceipt: owner,
    };
    let result = null;
    try {
      result = await bridge.toBridge(xvmCrossConfig);
    } catch (error: any) {
      console.log(error.message);
    }
    console.log(result.hash);
    expect(result.hash).toBeDefined;
  });

  test("evm ETH cross to op test", async () => {
    const evmCrossConfig = {
      fromChainID: "5",
      fromCurrency: "ETH",
      toChainID: "420",
      toCurrency: "ETH",
      transferValue: 0.001,
    };
    let result = null;
    try {
      result = await bridge.toBridge(evmCrossConfig);
    } catch (error: any) {
      console.log(error.message);
    }
    console.log(result.hash);
    expect(result.hash).toBeDefined;
  });

  test("zksync lite ETH cross to op test", async () => {
    const zksyncCrossConfig = {
      fromChainID: "zksync_test",
      fromCurrency: "ETH",
      toChainID: "420",
      toCurrency: "ETH",
      transferValue: 0.001,
    };
    let result = null;
    try {
      result = await bridge.toBridge(zksyncCrossConfig);
    } catch (error: any) {
      console.log(error.message);
    }
    console.log(result.txHash);
    expect(result.txHash).toBeDefined;
  });

  // test("loopring ETH cross test", async () => {
  //   const loopringCrossConfig = {
  //     fromChainID: "loopring_test",
  //     fromCurrency: "ETH",
  //     toChainID: "420",
  //     toCurrency: "ETH",
  //     transferValue: 0.001,
  //   };
  //   const tx = await bridge.toBridge(loopringCrossConfig);
  //   console.log(tx.txHash);
  //   expect(tx.txHash).toBeDefined;
  // });

  // test.only("starknet ETH cross to goerli test", async () => {
  //   const starknetCrossConfig = {
  //     fromChainID: "SN_GOERLI",
  //     fromCurrency: "ETH",
  //     toChainID: "5",
  //     toCurrency: "ETH",
  //     transferValue: 0.001,
  //     ext: {
  //       type: "0x03",
  //     },
  //   };
  //   const tx = await bridge.toBridge(starknetCrossConfig);
  //   console.log(tx.txHash);
  //   expect(tx.txHash).toBeDefined;
  // });

  test("transfer to starknet ETH cross by goerli test", async () => {
    const starknetCrossConfig = {
      fromChainID: "5",
      fromCurrency: "ETH",
      toChainID: "SN_GOERLI",
      toCurrency: "ETH",
      transferValue: 0.001,
      transferExt: {
        contractType: "0x03",
        receiveStarknetAddress:
          "0x04CC0189A24723B68aEeFf84EEf2c0286a1F03b7AECD14403E130Db011571f37",
      },
    };
    let result = null;
    try {
      result = await bridge.toBridge(starknetCrossConfig);
    } catch (error: any) {
      console.log(error.message);
    }
    console.log(result.hash);
    expect(result.hash).toBeDefined;
  });

  test("imx transfer ETH to scroll test", async () => {
    let result = null;
    try {
      const imxCrossConfig = {
        fromChainID: "immutableX_test",
        fromCurrency: "ETH",
        toChainID: "534351",
        toCurrency: "ETH",
        transferValue: 0.001,
      };
      result = await bridge.toBridge(imxCrossConfig);
    } catch (error: any) {
      console.log(error.message);
    }
    console.log(result);
    expect(result).toBeDefined;
  });
});
