import axios from "axios";
import mempoolJS from "@mempool/mempool.js";

export async function API(url: string, method: string, params: any) {
  const data = {
    jsonrpc: "1.0",
    id: "curltest",
    method: method,
    params: params,
  };

  const config = {
    auth: {
      username: process.env.user!,
      password: process.env.pass!,
    },
    headers: {
      "Content-Type": "text/plain",
    },
  };

  axios
    .post(url, data, config)
    .then((response) => {
      console.log(JSON.stringify(response.data));
    })
    .catch((error) => {
      if (error.response) {
        console.log(error.response);
        console.log("Status:", error.response.status);
      } else {
        console.log(error);
      }
    });
}

export async function getUTXOs(address: string) {
  const {
    bitcoin: { addresses },
  } = mempoolJS({
    hostname: "mempool.space",
    network: "testnet",
  });
  const addressTxsUtxo = await addresses.getAddressTxsUtxo({ address });
  return addressTxsUtxo;
}
