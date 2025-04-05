const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config({ path: "./config.env" });
const app = require("./app");

//MONGODB connection
const DB = process.env.MONGODB_URL.replace(
  "<PASSWORD>",
  process.env.DATABASE_PASSWORD
);

mongoose
  .connect(DB, {
    autoIndex: true,
  })
  .then((con) => {
    //console.log(con.connection);
    console.log("DB connection successful!");
  });

const port = process.env.PORT;
const server = app.listen(port, () => {
  console.log(`App running on port ${port}`);
});

// process.on("unhandledRejection", (err) => {
//   console.log(err.name, err.message);
//   console.log("UNHANDLED REJECTION! SHUTTING DOWN APPLICATION");
//   server.close(() => {
//     process.exit(1);
//   });
// });
