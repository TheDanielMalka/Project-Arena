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
    sources:   ".",        // ArenaEscrow.sol lives directly here
    tests:     "./test",
    cache:     "./cache",
    artifacts: "./artifacts",
  },
};
