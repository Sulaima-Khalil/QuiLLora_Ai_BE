// import request from "supertest";
// import app from "../app.js";

// describe("Auth Routes", () => {
//   test("login success", async () => {
//     const res = await request(app)
//       .post("/api/auth/login")
//       .send({ email: "a@test.com", password: "123" });

//     expect(res.status).toBe(200);
//     expect(res.body.token).toBeDefined();
//   });
// });


import request from "supertest";
import app from "../app.js";
import bcrypt from "bcryptjs";

jest.mock("../components/module/UserModule.js", () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(() => ({
      _id: "123",
      name: "Test User",
      email: "a@test.com",
      password: "$2b$10$hashedpassword",
      select() {
        return this;
      }
    }))
  }
}));

jest.mock("bcryptjs", () => ({
  compare: jest.fn(() => true),
}));

beforeAll(() => {
  process.env.JWT_SECRET = "testsecret";
});

describe("Auth Routes", () => {
  test("login success", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "a@test.com", password: "123" });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });
});
