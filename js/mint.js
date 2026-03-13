// ===== MINT — WALLET CONNECT & CONTRACT INTERACTION =====
(function () {
  // ========== CONFIG ==========
  // After deploying, paste your contract address here:
  const CONTRACT_ADDRESS = '0xe51668B865Cd75A4Bc01382f38aFf20a7D5805EC';
  const SEPOLIA_CHAIN_ID = '0xaa36a7'; // 11155111
  const MINT_PRICE = 0.08; // ETH
  const MAX_PER_TX = 5;
  const MAX_SUPPLY = 10000;

  // Minimal ABI — only what we need
  const CONTRACT_ABI = [
    'function mint(uint256 quantity) external payable',
    'function totalSupply() public view returns (uint256)',
    'function mintActive() public view returns (bool)',
    'function MAX_SUPPLY() public view returns (uint256)',
    'function MINT_PRICE() public view returns (uint256)',
  ];

  // ========== DOM ==========
  const connectBtn = document.getElementById('mintConnectBtn');
  const mintBtn = document.getElementById('mintActionBtn');
  const walletInfo = document.getElementById('mintWalletInfo');
  const walletAddr = document.getElementById('mintWalletAddr');
  const disconnectBtn = document.getElementById('mintDisconnect');
  const qtyDisplay = document.getElementById('mintQtyDisplay');
  const qtyMinus = document.getElementById('mintQtyMinus');
  const qtyPlus = document.getElementById('mintQtyPlus');
  const totalDisplay = document.getElementById('mintTotalValue');
  const supplyCount = document.getElementById('mintSupplyCount');
  const progressFill = document.getElementById('mintProgressFill');
  const statusEl = document.getElementById('mintStatus');

  if (!connectBtn) return;

  let provider = null;
  let signer = null;
  let contract = null;
  let quantity = 1;
  let connected = false;

  // ========== HELPERS ==========
  function shortAddr(addr) {
    return addr.slice(0, 6) + '...' + addr.slice(-4);
  }

  function updateTotal() {
    qtyDisplay.textContent = quantity;
    totalDisplay.textContent = (quantity * MINT_PRICE).toFixed(2) + ' ETH';
  }

  function setStatus(msg, type) {
    statusEl.textContent = msg;
    statusEl.className = 'mint-status' + (type ? ' ' + type : '');
  }

  async function updateSupply() {
    try {
      if (contract) {
        const supply = await contract.totalSupply();
        const count = Number(supply);
        supplyCount.innerHTML = `<span>${count.toLocaleString()}</span> / ${MAX_SUPPLY.toLocaleString()}`;
        progressFill.style.width = ((count / MAX_SUPPLY) * 100) + '%';
      }
    } catch (e) {
      // Contract not deployed yet — show 0
      supplyCount.innerHTML = `<span>0</span> / ${MAX_SUPPLY.toLocaleString()}`;
    }
  }

  // ========== WALLET CONNECT ==========
  async function connectWallet() {
    if (typeof window.ethereum === 'undefined') {
      setStatus('MetaMask not detected. Please install MetaMask.', 'error');
      return;
    }

    try {
      setStatus('Connecting wallet...', '');

      // Request accounts
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });

      // Switch to Sepolia if needed
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: SEPOLIA_CHAIN_ID }],
        });
      } catch (switchError) {
        if (switchError.code === 4902) {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: SEPOLIA_CHAIN_ID,
              chainName: 'Sepolia Testnet',
              nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
              rpcUrls: ['https://eth-sepolia.g.alchemy.com/v2/dp8VBRpY6XHIKrMgPMgnn'],
              blockExplorerUrls: ['https://sepolia.etherscan.io'],
            }],
          });
        } else {
          throw switchError;
        }
      }

      // Set up ethers
      provider = new ethers.BrowserProvider(window.ethereum);
      signer = await provider.getSigner();

      if (CONTRACT_ADDRESS) {
        contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      }

      // Update UI
      connected = true;
      const address = await signer.getAddress();
      walletAddr.textContent = shortAddr(address);
      connectBtn.style.display = 'none';
      walletInfo.style.display = 'flex';
      mintBtn.style.display = 'block';
      setStatus('Wallet connected — Sepolia Testnet', 'success');

      await updateSupply();
    } catch (err) {
      console.error(err);
      setStatus(err.message || 'Connection failed', 'error');
    }
  }

  function disconnectWallet() {
    connected = false;
    provider = null;
    signer = null;
    contract = null;
    connectBtn.style.display = 'block';
    walletInfo.style.display = 'none';
    mintBtn.style.display = 'none';
    setStatus('Wallet disconnected', '');
  }

  // ========== MINT ==========
  async function doMint() {
    if (!connected) return;

    if (!CONTRACT_ADDRESS) {
      setStatus('Contract not deployed yet. Deploy first, then add the address to mint.js', 'error');
      return;
    }

    try {
      mintBtn.disabled = true;
      setStatus(`Minting ${quantity} NFT${quantity > 1 ? 's' : ''}...`, '');

      const value = ethers.parseEther((MINT_PRICE * quantity).toString());
      const tx = await contract.mint(quantity, { value });

      setStatus('Transaction sent. Waiting for confirmation...', '');
      await tx.wait();

      setStatus(`Successfully minted ${quantity} Vanguard NFT${quantity > 1 ? 's' : ''}!`, 'success');
      await updateSupply();
    } catch (err) {
      console.error(err);
      if (err.code === 'ACTION_REJECTED') {
        setStatus('Transaction cancelled', 'error');
      } else if (err.reason) {
        setStatus(err.reason, 'error');
      } else {
        setStatus('Mint failed — check console for details', 'error');
      }
    } finally {
      mintBtn.disabled = false;
    }
  }

  // ========== EVENTS ==========
  connectBtn.addEventListener('click', connectWallet);
  disconnectBtn.addEventListener('click', disconnectWallet);
  mintBtn.addEventListener('click', doMint);

  qtyMinus.addEventListener('click', () => {
    if (quantity > 1) { quantity--; updateTotal(); }
  });

  qtyPlus.addEventListener('click', () => {
    if (quantity < MAX_PER_TX) { quantity++; updateTotal(); }
  });

  // Listen for account/chain changes
  if (window.ethereum) {
    window.ethereum.on('accountsChanged', (accounts) => {
      if (accounts.length === 0) disconnectWallet();
      else connectWallet();
    });
    window.ethereum.on('chainChanged', () => window.location.reload());
  }

  // Init
  updateTotal();
  supplyCount.innerHTML = `<span>0</span> / ${MAX_SUPPLY.toLocaleString()}`;
})();
