/** @type import('hardhat/config').HardhatUserConfig */
require("@nomicfoundation/hardhat-toolbox");

module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  paths: {
    sources:   "./src",    // ArenaEscrow.sol lives in src/ — keeps node_modules out of compile scope
    tests:     "./test",
    cache:     "./cache",
    artifacts: "./artifacts",
  },
};
