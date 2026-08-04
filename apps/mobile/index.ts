import { registerRootComponent } from "expo";

// I task di background si registrano PRIMA di React: quando il sistema
// sveglia il processo per un evento di prossimità non c'è nessuna UI, solo
// questo import.
import "./src/tasks";

import App from "./App";

registerRootComponent(App);
