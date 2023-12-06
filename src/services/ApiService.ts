import Axios, { AxiosResponse } from "axios";
import {
  QueryRatesData,
  Rates,
  IChainInfo,
  ICrossRule,
} from "../types/common.types";
import { equalsIgnoreCase } from "../utils";
import config from "../constant/config";

const COIN_BASE_API_URL = "https://api.coinbase.com";

export async function getZKSTokenList(req: {
  from: number;
  limit: number;
  direction: string;
  fromChainID: number;
}) {
  const url = `${
    req.fromChainID === 512 ? config.ZKSpace.Rinkeby : config.ZKSpace.Mainnet
  }/tokens?from=${req.from}&limit=${req.limit}&direction=${req.direction}`;
  try {
    const response = await Axios.get(url);
    if (response.status === 200) {
      const respData = response.data;
      if (respData.success) {
        return respData.data;
      } else {
        throw new Error("respData.status not success");
      }
    } else {
      throw new Error("getZKSTokenList NetWorkError");
    }
  } catch (error: any) {
    throw new Error(`getZKSTokenList error = ${error.message}`);
  }
}

export async function queryRatesByCurrency(
  currency: string
): Promise<Rates | undefined> {
  try {
    const resp: QueryRatesData = await Axios.get(
      `${COIN_BASE_API_URL}/v2/exchange-rates?currency=${currency}`
    );
    const data = resp.data;
    if (!data || equalsIgnoreCase(data.currency, currency) || !data.rates) {
      return undefined;
    }
    return data.rates;
  } catch (error) {
    return undefined;
  }
}

export async function queryTradingPairs(): Promise<{
  ruleList: ICrossRule[];
  chainList: IChainInfo[];
}> {
  try {
    const res: AxiosResponse<{
      result: {
        chainList: IChainInfo[];
        ruleList: ICrossRule[];
      };
    }> = await Axios.post(
      "https://openapi2.orbiter.finance/v3/yj6toqvwh1177e1sexfy0u1pxx5j8o47",
      {
        id: 1,
        jsonrpc: "2.0",
        method: "orbiter_getTradingPairs",
        params: [],
      }
    );
    const result = res?.data?.result;
    if (result && Object.keys(result).length > 0) {
      return {
        ruleList: result?.ruleList ?? [],
        chainList: result?.chainList ?? [],
      };
    } else {
      return Promise.reject(res);
    }
  } catch (error) {
    return Promise.reject(error);
  }
}
