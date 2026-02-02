import { createSessionStore } from "./sessionStore";
import * as storage from "./storage";

export const sessionStore = createSessionStore(storage);
