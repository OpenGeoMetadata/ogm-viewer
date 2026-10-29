import { locateLercWasm } from './lerc';

// Configure LERC before importing the worker handler; import evaluation order guarantees this.
locateLercWasm();
