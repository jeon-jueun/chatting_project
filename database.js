const { MongoClient } = require("mongodb");
require("dotenv").config();
const url = process.env.DB_URL;
let connectDB = new MongoClient(url).connect();

module.exports = connectDB;
