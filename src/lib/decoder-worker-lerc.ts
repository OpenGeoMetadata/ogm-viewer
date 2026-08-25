import { locateLercWasm } from './lerc';

// The worker's half of the LERC wiring; see locateLercWasm for what it is for.
//
// A module of its own, imported before the handler that decodes tiles, because that ordering is the
// only one the language guarantees. Written as a statement in decoder-worker.ts it would run after
// the handler's own import had already been evaluated and its message listener added, leaving a tile
// that arrived in between to be decoded through the registry entry this replaces.
locateLercWasm();
