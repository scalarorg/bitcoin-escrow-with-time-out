require("dotenv").config();
const axios = require("axios");

// Bitcoin to Satoshis
function B2S(amount_BTC) {
  return parseInt(amount_BTC * 10 ** 8);
}

function NumtoHex(number) {
  return number.toString(16).padStart(2, "0")
}

async function API(url, method, params) {
  const data = {
    jsonrpc: "1.0",
    id: "curltest",
    method: method,
    params: [params],
  };

  const config = {
    auth: {
      username: process.env.user,
      password: process.env.pass,
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
      if (error.response.data) {
        console.log("Status:", error.response.status);
        console.error("Error:", error.response.data.error);
      } else console.log(error);
    });
}

module.exports = { B2S, API, NumtoHex };
