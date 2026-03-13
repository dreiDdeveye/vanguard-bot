require("@nomicfoundation/hardhat-toolbox");

const PRIVATE_KEY = "97d143879463c2eff45dc4577ab7688a59f71ef7f7a9c0f62d423029f56b3344";

module.exports = {
  solidity: {
    version: "0.8.27",
    settings: {
      evmVersion: "cancun",
    },
  },
  networks: {
    sepolia: {
      url: "https://eth-sepolia.g.alchemy.com/v2/dp8VBRpY6XHIKrMgPMgnn",
      accounts: [PRIVATE_KEY],
    },
  },
};
