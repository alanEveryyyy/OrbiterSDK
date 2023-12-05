import {
  BigNumberish,
  Contract,
  ethers,
  isHexString,
  Provider,
  Signer,
} from "ethers-6";
import { Coin_ABI, CROSS_ADDRESS_ABI } from "../constant/abi";
import { hexConcat, hexDataSlice, sendTransaction, sleep } from "./util";
import { padStart } from "lodash";
import ChainsService from "../services/ChainsService";
import BigNumber from "bignumber.js";

export const CrossAddressTypes = {
  "0x01": "Cross Ethereum Address",
  "0x02": "Cross Dydx Address",
  "0x03": "Cross Stark Address",
};

export class CrossAddress {
  private chainsService: ChainsService;
  private contractAddress: string;
  private orbiterChainId: number;
  private provider: Provider | null;
  private signer: Signer;
  private networkId: string | number;
  private providerNetworkId?: bigint | null;

  constructor(
    provider: Provider | null,
    orbiterChainId: string | number,
    signer: Signer,
    contractAddress?: string
  ) {
    this.chainsService = ChainsService.getInstance();
    const chainInfo = this.chainsService.getChainInfo(Number(orbiterChainId));
    this.contractAddress =
      contractAddress ||
      (chainInfo?.xvmList && chainInfo.xvmList.length
        ? chainInfo.xvmList[0]
        : "");
    if (!this.contractAddress) {
      console.log("Sorry, miss param [contractAddress]");
    }

    this.provider = provider;
    this.orbiterChainId = Number(orbiterChainId);
    this.signer = signer;
    this.networkId = chainInfo.networkId;
  }

  async checkNetworkId() {
    if (!this.providerNetworkId) {
      this.providerNetworkId =
        this.provider && (await this.provider.getNetwork()).chainId;
    }
    if (this.providerNetworkId != BigInt(this.networkId)) {
      throw new Error(
        `Sorry, currentNetworkId: ${this.providerNetworkId} no equal networkId: ${this.networkId}`
      );
    }
  }

  /**
   * @param {Contract} contractErc20
   */
  async getAllowance(
    contractErc20: Contract,
    contractAddress = this.contractAddress
  ) {
    const ownerAddress = await this.signer.getAddress();
    return await contractErc20.allowance(ownerAddress, contractAddress);
  }

  /**
   *
   * @param {string} tokenAddress 0x...
   * @param {BigInt} amount
   */
  async approveERC20(
    tokenAddress: string,
    amount: BigInt,
    contractAddress = this.contractAddress
  ) {
    await this.checkNetworkId();
    const contract = new ethers.Contract(tokenAddress, Coin_ABI, this.provider);
    const currentAllowance = await this.getAllowance(contract, contractAddress);
    await contract.approve(contractAddress, amount);
    try {
      // Waitting approve succeed
      for (let index = 0; index < 5000; index++) {
        const allowance = await this.getAllowance(contract, contractAddress);
        if (!currentAllowance.eq(allowance)) {
          if (amount > allowance) {
            throw new Error(`Approval amount is insufficient`);
          }
          break;
        }
        await sleep(2000);
      }
    } catch (error) {
      throw error;
    }
  }

  /**
   *
   * @param {string} tokenAddress 0x...
   * @param {string} to
   * @param {ethers.BigNumber} amount
   * @param {{type: string, value: string} | undefined} ext
   * @return {Promise<{hash: string}>}
   */
  async transfer(
    to: string,
    amount: BigNumber,
    ext: { type: string; value: string } | undefined
  ): Promise<{ hash: string }> {
    await this.checkNetworkId();

    if (
      ext &&
      !CrossAddressTypes[ext?.type as keyof typeof CrossAddressTypes]
    ) {
      throw new Error(`Invalid crossAddressType : ${ext.type}`);
    }

    const contract = new ethers.Contract(
      this.contractAddress,
      CROSS_ADDRESS_ABI,
      this.signer
    );

    const extHex = CrossAddress.encodeExt(ext);

    const options = { value: new BigNumber(amount) };

    return await contract.transfer(to, extHex, options);
  }

  /**
   *
   * @param {string} tokenAddress 0x...
   * @param {string} to
   * @param {ethers.BigNumber} amount
   * @param {{type: string, value: string} | undefined} ext
   * @return {Promise<{hash: string}>}
   */
  async transferERC20(
    tokenAddress: string,
    to: string,
    amount: BigInt,
    ext?: { type: string; value: string } | undefined
  ): Promise<{ hash: string }> {
    await this.checkNetworkId();

    if (
      ext &&
      !CrossAddressTypes?.[ext.type as keyof typeof CrossAddressTypes]
    ) {
      throw new Error(`Invalid crossAddressType : ${ext.type}`);
    }
    // Check and approve erc20 amount
    const contractErc20 = new ethers.Contract(
      tokenAddress,
      Coin_ABI,
      this.provider
    );

    const allowance = await this.getAllowance(contractErc20);
    if (amount > allowance) {
      await this.approveERC20(tokenAddress, amount);
    }

    const contract = new ethers.Contract(
      this.contractAddress,
      CROSS_ADDRESS_ABI,
      this.signer
    );
    const extHex = CrossAddress.encodeExt(ext);
    return await contract.transferERC20(tokenAddress, to, amount, extHex);
  }

  async contractApprove(
    tokenAddress: string,
    amount: BigInt,
    contractAddress?: string
  ) {
    if (!contractAddress) throw new Error("contract approve address is empty!");
    const contractErc20 = new ethers.Contract(
      tokenAddress,
      Coin_ABI,
      this.provider
    );
    const allowance = await this.getAllowance(contractErc20, contractAddress);
    if (amount > allowance) {
      await this.approveERC20(tokenAddress, amount, contractAddress);
    }
  }

  /**
   *
   * @param {{type: string, value: string} | undefined} ext
   * @returns {string} hex
   */
  static encodeExt(ext: { type: string; value: string } | undefined): string {
    if (!ext || !isHexString(ext.type)) {
      return "0x";
    }
    if (!ext.value) {
      return ext.type;
    }

    if (ext.type == "0x03" && isHexString(ext.value)) {
      return hexConcat([
        ext.type,
        CrossAddress.fix0xPadStartAddress(ext.value, 66),
      ]);
    }
    return hexConcat([ext.type, ext.value]);
  }

  static fix0xPadStartAddress(address: string, length: number) {
    if (!address) {
      return "";
    }
    if (String(address).indexOf("0x") !== 0) {
      return "";
    }
    address = address.replace("0x", "");
    if (address.length < length) {
      return `0x${padStart(address, length - 2, "0")}`;
    }
    return address;
  }

  /**
   *
   * @param {string} hex
   * @returns {{type: string, value: string} | undefined}
   */
  static decodeExt(hex: string): { type: string; value: string } | undefined {
    if (!isHexString(hex)) {
      return undefined;
    }

    const type = hexDataSlice(hex, 0, 1);
    const value = hexDataSlice(hex, 1);
    return { type, value };
  }

  /**
   * @param {string} input 0x...
   */
  static parseTransferInput(input: string) {
    const [to, ext] = ethers.AbiCoder.defaultAbiCoder().decode(
      ["address", "bytes"],
      hexDataSlice(input, 4)
    );
    return { to, ext: CrossAddress.decodeExt(ext) };
  }
}
