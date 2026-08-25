// Where lerc's wasm module lives, told to the decoder registry before anything can be asked to
// decode a tile through it. First, and as an import rather than a statement, so that it is in place
// before the handler below adds its message listener - see the file itself for why that matters.
import './decoder-worker-lerc';

// What runs inside a COG decoder worker: upstream's own handler, which answers the message protocol
// its DecoderPool speaks - so the two can never drift out of step, as a copy of the protocol here
// would. Its only export is that side effect, which is why the bundle that inlines this file has to
// be told to keep it: @developmentseed/geotiff declares itself side-effect free, and left to shake
// what it likes a bundler reduces this whole file to nothing.
//
// Nothing imports this module. The build bundles it on its own and inlines the result as a string
// for the pool to start workers from; see createDecoderWorker in decoder.ts for why they start from
// a string rather than a file, and stencil.config.ts for how the string gets there.
import '@developmentseed/geotiff/pool/worker';
