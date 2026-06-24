import { createApp } from "../server.js";

const app = await createApp();
const result = await app.pollOnce();
console.log(JSON.stringify(result, null, 2));
