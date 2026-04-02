import handler from "./miniapp.js";

export default (req: any, res: any) => {
  return handler({ ...req, query: { ...req.query, action: "drafts" } }, res);
};
