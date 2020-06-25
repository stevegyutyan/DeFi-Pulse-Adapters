const BigNumber = require('bignumber.js')

const sdk = require('../../sdk')
const { getSupportedTokens } = require('./utils')

const START_BLOCK = 6627917
const FACTORY = '0xc0a47dFe034B400B47bDaD5FecDa2621de6c4d95'
const ETH = '0x0000000000000000000000000000000000000000'.toLowerCase()

module.exports = async function tvl(_, block) {
  const supportedTokens = await getSupportedTokens()

  const logs = await sdk.api.util
    .getLogs({
      keys: [],
      toBlock: block,
      target: FACTORY,
      fromBlock: START_BLOCK,
      topic: 'NewExchange(address,address)',
    })
    .then(({ output }) => output)

  const exchanges = {}
  logs.forEach((log) => {
    const tokenAddress = `0x${log.topics[1].substring(26)}`.toLowerCase()

    // only consider supported tokens
    if (supportedTokens.includes(tokenAddress)) {
      const exchangeAddress = `0x${log.topics[2].substring(26)}`.toLowerCase()
      exchanges[exchangeAddress] = tokenAddress
    }
  })

  const tokenBalances = await sdk.api.abi
    .multiCall({
      abi: 'erc20:balanceOf',
      calls: Object.keys(exchanges).map((exchangeAddress) => ({
        target: exchanges[exchangeAddress],
        params: exchangeAddress,
      })),
      block,
    })
    .then(({ output }) => output)

  // note that this undercounts ETH locked
  // it only measures ETH in exchanges for supported tokens
  const ETHBalances = await Promise.all(
    Object.keys(exchanges).map((exchangeAddress) =>
      sdk.api.eth
        .getBalance({
          target: exchangeAddress,
          block,
        })
        .then(({ output }) => output)
    )
  )

  return tokenBalances.reduce(
    (accumulator, tokenBalance) => {
      if (tokenBalance.success) {
        const balanceBigNumber = new BigNumber(tokenBalance.output)
        if (!balanceBigNumber.isZero()) {
          const tokenAddress = tokenBalance.input.target.toLowerCase()
          accumulator[tokenAddress] = balanceBigNumber.toFixed()
        }
      }
      return accumulator
    },
    {
      [ETH]: ETHBalances.reduce(
        (accumulator, ETHBalance) =>
          accumulator.plus(new BigNumber(ETHBalance)),
        new BigNumber('0')
      ).toFixed(),
    }
  )
}
