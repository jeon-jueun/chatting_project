const express = require("express");
const app = express();
const path = require("path");
const { ObjectId } = require("mongodb");
const connectDB = require("./database.js");
const bcrypt = require("bcrypt");
require("dotenv").config();
const MongoStore = require("connect-mongo");
const session = require("express-session");
const passport = require("passport");
const LocalStrategy = require("passport-local");
const { createServer } = require("http");
const { Server } = require("socket.io");
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
    credentials: true,
    methods: ["GET", "POST"],
  },
});

app.use(express.static(__dirname + "/public"));
app.use(express.json());
const cors = require("cors");
app.use(
  cors({
    origin: "http://localhost:3000",
    credentials: true,
    methods: ["GET", "POST"],
  })
);

// client react file을 불러오는 코드
app.use(express.static(path.join(__dirname, "/client/build")));
app.get("/", function (요청, 응답) {
  응답.sendFile(path.join(__dirname, "/client/build/index.html"));
});

// 유저가 보낸 정보 서버에서 쉽게 출력해 보고 싶을때 아래 두 코드 작성 필요. 요청.body로 꺼내볼 수 있게 함
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let db;
connectDB
  .then((client) => {
    console.log("DB연결성공");
    db = client.db("termproject");

    server.listen(process.env.PORT, () => {
      console.log("http://localhost:8080 에서 서버 실행중");
    });
  })
  .catch((err) => {
    console.log(err);
  });

app.use(passport.initialize());
app.use(
  session({
    resave: false,
    saveUninitialized: false,
    secret: process.env.SECRET,
    cookie: { maxAge: 1000 * 60 },
    store: MongoStore.create({
      mongoUrl: process.env.DB_URL,
      dbName: "termproject",
    }),
  })
);

app.use(passport.session());

passport.use(
  new LocalStrategy(async (inputId, inputPassword, cb) => {
    let result = await db.collection("user").findOne({ username: inputId });
    if (!result) {
      return cb(null, false, { message: "아이디 DB에 없음" });
    }

    if (await bcrypt.compare(inputPassword, result.password)) {
      return cb(null, result);
    } else {
      return cb(null, false, { message: "비번불일치" });
    }
  })
);

passport.serializeUser((user, done) => {
  process.nextTick(() => {
    done(null, { id: user._id, username: user.username });
  });
});

passport.deserializeUser(async (user, done) => {
  let result = await db
    .collection("user")
    .findOne({ _id: new ObjectId(user.id) });
  delete result.password;
  process.nextTick(() => {
    return done(null, result);
  });
});

// =========================================================================== 로그인 API
app.post("/login", async (요청, 응답, next) => {
  passport.authenticate("local", (error, user, info) => {
    if (error) return 응답.status(500).json(error);
    if (!user)
      return 응답.status(401).json({
        success: false,
        error: "NO_USER",
        message: "아이디 혹은 비밀번호를 잘못입력했습니다",
      });
    요청.logIn(user, (err) => {
      if (err) return next(err);
      응답.status(200).json({
        success: true,
        username: 요청.user.username,
        message: "로그인이 성공했습니다.",
      });
    });
  })(요청, 응답, next);
});

// =========================================================================== 회원가입 API
app.post("/register", async (요청, 응답) => {
  try {
    let idDupCheck = await db
      .collection("user")
      .findOne({ username: 요청.body.username });
    if (!idDupCheck) {
      let hash = await bcrypt.hash(요청.body.password, 10);
      await db.collection("user").insertOne({
        alias: 요청.body.alias,
        username: 요청.body.username,
        password: hash,
      });
      응답.status(200).json({
        success: true,
        message: "회원가입이 완료되었습니다.",
      });
    } else {
      //에러 응답
      응답.status(400).json({
        success: false,
        error: "ID_DUPLICATE",
        message: "이미 사용 중인 ID입니다.",
      });
    }
  } catch (error) {
    console.error("에러 발생:", error);
    응답.status(500).json({
      success: false,
      error: "INTERNAL_SERVER_ERROR",
      message: "서버 내부 오류가 발생했습니다.",
    });
  }
});

// ============================================== 채팅방 GET API
app.get("/chat", async (요청, 응답) => {
  try {
    let result = await db
      .collection("chatroom")
      .find({ member: { $in: [요청.user.username] } })
      .toArray();
    응답.send({ chatroom: result });
  } catch (e) {
    console.log(e);
    응답.send("DB에러남");
  }
});

// ============================================================채팅방 추가 POST API
app.post("/addchatroom", async (요청, 응답) => {
  try {
    let chatRoomDupCheck = await db.collection("chatroom").findOne({
      $and: [{ member: 요청.body.username }, { member: 요청.user.username }],
    });
    let memberDupCheck = false;
    if (요청.body.username === 요청.user.username) {
      memberDupCheck = true;
    }
    if (!chatRoomDupCheck && !memberDupCheck) {
      let chatUser = await db.collection("user").findOne({
        username: 요청.body.username,
      });
      await db.collection("chatroom").insertOne({
        title: [chatUser.alias, 요청.user.alias],
        member: [요청.body.username, 요청.user.username],
        createdAt: 요청.body.createdAt,
      });
      응답.status(200).json({
        success: true,
        message: "채팅방이 생성되었습니다.",
      });
    } else {
      //에러 응답
      let errorMessage = "이미 친구 추가 된 ID 입니다.";
      if (memberDupCheck) {
        errorMessage = "본인과 대화할 수 없습니다.";
      }
      응답.status(400).json({
        success: false,
        error: "ID_DUPLICATE",
        message: errorMessage,
      });
    }
  } catch (error) {
    console.error("에러 발생:", error);
    응답.status(500).json({
      success: false,
      error: "INTERNAL_SERVER_ERROR",
      message: "서버 내부 오류가 발생했습니다.",
    });
  }
});

// ============================================= 채팅방 상세 GET API
app.get("/chat/:id", async (요청, 응답) => {
  try {
    let result = await db
      .collection("chatMessage")
      .find({ parentRoom: new ObjectId(요청.params.id) })
      .toArray();
    if (result == null) {
      응답.send({ chatMessage: [] });
    } else {
      응답.send({ chatMessage: result });
    }
  } catch (e) {
    응답.send(e);
  }
});

// =========================================================================== 소켓 통신 API
io.on("connection", (socket) => {
  socket.on("ask-join", async (data) => {
    socket.join(data);
  });
  socket.on("message-send", async (data) => {
    if (data.username === "undefined") {
      io.to(data.room).emit("message-broadcast", "UNDEFINED_USER");
    } else {
      await db.collection("chatMessage").insertOne({
        parentRoom: new ObjectId(data.room),
        message: data.message,
        who: data.username,
        createDate: new Date(),
      });
      io.to(data.room).emit("message-broadcast", {
        createDate: new Date(),
        message: data.message,
        parentRoom: data.room,
        who: data.username,
        _id: "임시",
      });
    }
  });
});
