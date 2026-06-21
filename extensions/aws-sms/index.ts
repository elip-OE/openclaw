// Aws Sms plugin entrypoint registers its OpenClaw integration.
import { defineBundledChannelEntry } from "openclaw/plugin-sdk/channel-entry-contract";

export default defineBundledChannelEntry({
  id: "aws-sms",
  name: "AWS SMS",
  description: "AWS End User Messaging SMS channel plugin for OpenClaw text and MMS messages.",
  importMetaUrl: import.meta.url,
  plugin: {
    specifier: "./channel-plugin-api.js",
    exportName: "awsSmsPlugin",
  },
  runtime: {
    specifier: "./api.js",
    exportName: "setAwsSmsRuntime",
  },
});
