// Configure LERC before the worker handler starts accepting tile messages.
import './decoder-worker-lerc';

// This import registers the worker handler as a side effect; the build must retain it.
import '@developmentseed/geotiff/pool/worker';
