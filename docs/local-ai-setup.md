# Munetios local AI setup

Tasks suggestions run inside the Munetios Node server through `node-llama-cpp`.
The GGUF model and prompts are not exposed to the browser, and no third-party
inference API is used.

## Server requirements

- Node.js 20 or newer
- A licensed instruction-tuned GGUF model
- Enough RAM or VRAM for the selected quantization
- A persistent model directory outside the public web root

For production, start with a Llama 3.1 8B Instruct `Q4_K_M` GGUF model. Review
and accept the model license before deploying it.

## Install the runtime

```sh
npm install
```

`package.json` allows the `node-llama-cpp` postinstall script so its official
prebuilt bindings are resolved during installation. The package automatically
selects CUDA, Vulkan, Metal, or CPU support available on the server.

Inspect the server:

```sh
npx --no node-llama-cpp inspect gpu
```

Download an approved GGUF model into the server model directory:

```sh
npx --no node-llama-cpp pull --dir /srv/munetios/models MODEL_GGUF_URL
```

The model file is operational data and must not be committed to Git.

## Configure Munetios

Set these environment variables on each Munetios application server:

```dotenv
MUNETIOS_LLAMA_MODEL_PATH=/srv/munetios/models/Meta-Llama-3.1-8B-Instruct.Q4_K_M.gguf
MUNETIOS_LLAMA_CONTEXT_SIZE=2048
```

Restart the Munetios Node process after changing the model or environment.
The first suggestion request loads the model once; later requests reuse that
model. Generations are serialized per Node process to prevent overlapping
requests from exhausting server memory.

For multiple application instances, install the same model on every instance,
or route Tasks suggestion requests to dedicated internal Munetios inference
workers. Never expose the inference worker or model directory publicly.

## Safety and operations

The Tasks API requires an authenticated same-origin request and rate-limits each
account. It filters unsafe and prompt-injection-like input before inference,
uses a restrictive system prompt, constrains generation with a JSON grammar,
and validates the generated category, description, and steps afterward.

Application filters reduce risk but do not make a language model infallible.
Monitor blocked and failed requests without logging raw private task text,
review model upgrades before deployment, and keep `node-llama-cpp` and the
server OS patched.
