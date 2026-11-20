import type { GuildMember } from "discord.js";

export interface BridgeActor {
  member?: GuildMember;
  owner: boolean;
  tier: 1 | 2 | 3;
}

let current: BridgeActor | undefined;

export function setBridgeActor(actor?: BridgeActor): void {
  current = actor;
}

export function getBridgeActor(): BridgeActor | undefined {
  return current;
}
