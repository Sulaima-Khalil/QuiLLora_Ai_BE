import request from "supertest";
import app from "../app.js";
import bcrypt from "bcryptjs";


jest.mock("../components/module/UserModule.js", () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(() => null), 
    create: jest.fn((data) => ({
      _id: "123",
      name: data.name,
      email: data.email
    }))
  }
}));

jest.mock("bcryptjs", () => ({
  hash: jest.fn(() => "hashedpassword")
}));

beforeAll(() => {
  process.env.JWT_SECRET = "testsecret";
});


describe("Auth Routes - Register", () => {
  test("register success", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Test User",
        email: "test@test.com",
        password: "123456"
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.email).toBe("test@test.com");
  });
});
