import addressData from './address.json';
import { chronoAbi } from './chronoAbi';
export { botTestnet, botMainnet } from './chain';

export const contractAddress = addressData.address as `0x${string}`;
export const deployedConstants = {
  penaltyRecipient: addressData.penaltyRecipient as `0x${string}`,
  penaltyBps: addressData.penaltyBps,
  minLockSeconds: addressData.minLockSeconds,
  maxLockSeconds: addressData.maxLockSeconds,
};

export { chronoAbi };
