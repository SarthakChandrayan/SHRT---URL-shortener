import dotenv from "dotenv";
import path from "node:path";

// Always load backend/.env, even when the process was started from the repo root.
// import.meta.dirname is this file's folder (src/), so .. is the backend package.
dotenv.config({ path: path.join(import.meta.dirname, "..", ".env") });
