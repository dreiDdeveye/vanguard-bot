const hre = require("hardhat");

async function main() {
  const baseURI = "ipfs://YOUR_CID/";

  const Vanguard = await hre.ethers.getContractFactory("Vanguard");
  const vanguard = await Vanguard.deploy(baseURI);

  await vanguard.waitForDeployment();
  const address = await vanguard.getAddress();

  console.log("Vanguard deployed to:", address);
  console.log("Activate minting with: npx hardhat console --network sepolia");
  console.log('Then run: (await ethers.getContractAt("Vanguard", "' + address + '")).setMintActive(true)');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
