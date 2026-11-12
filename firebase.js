import { initializeApp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";
import { getDatabase, ref, onValue } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyDw1lelsmttTSG9BcqhDo_2UmiakWxpuK4",
  authDomain: "vetrecovery-6f390.firebaseapp.com",
  databaseURL: "https://vetrecovery-6f390-default-rtdb.firebaseio.com",
  projectId: "vetrecovery-6f390",
  storageBucket: "vetrecovery-6f390.firebasestorage.app",
  messagingSenderId: "1093950404836",
  appId: "1:109395040483:web:e9a6e75c61d454e01ed4f1",
  measurementId: "G-M3JP7DZRM3"
};

const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

export { database, ref, onValue };
