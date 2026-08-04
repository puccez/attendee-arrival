export const CLOCK = Symbol("CLOCK");

/** Orologio iniettabile: nei test la consegna ha un "adesso" controllato. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};
