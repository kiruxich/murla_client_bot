import handler from "./miniapp.js";

export default (req: any, res: any) => {
  return handler({ ...req, body: { ...req.body, action: "order-edit" } }, res);
};
