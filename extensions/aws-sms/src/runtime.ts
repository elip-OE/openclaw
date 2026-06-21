// Aws Sms plugin module implements runtime behavior.
import { createPluginRuntimeStore, type PluginRuntime } from "openclaw/plugin-sdk/runtime-store";

const { setRuntime: setAwsSmsRuntime, getRuntime: getAwsSmsRuntime } =
  createPluginRuntimeStore<PluginRuntime>({
    pluginId: "aws-sms",
    errorMessage: "AWS SMS runtime not initialized - plugin not registered",
  });

export { getAwsSmsRuntime, setAwsSmsRuntime };
