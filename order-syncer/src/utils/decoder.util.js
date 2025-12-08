import { HTTP_STATUS_SERVER_ERROR } from "../constants/http.status.constants";
import CustomError from "../errors/custom.error";

const decodeToString = (encodedMessageBody) => {
  const buff = Buffer.from(encodedMessageBody, 'base64');
  return buff.toString().trim();
};

export const decodeToJson = (encodedMessageBody) => {
  try {
    const decodedString = decodeToString(encodedMessageBody);
    return JSON.parse(decodedString);
  } catch (error) {
    throw new CustomError(HTTP_STATUS_SERVER_ERROR, 'Invalid message format: unable to parse JSON');
  }
};
