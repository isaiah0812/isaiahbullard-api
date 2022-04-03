import { ZaetabaseDocument } from "."
import { ID_REGEX, NON_ID_CHARACTER_REGEX } from "../utils/helpers";
import { ID_FIELD_ERROR_MESSAGE, ID_FIELD_NAME, URL_FIELD_ERROR_MESSAGE, ValidationError } from "./errorHandling";

const PICS_FIELD_NAME = "pics";
const PICS_FIELD_ERROR_MESSAGE = "Items in array must be valid URL strings";

type SizeType = {
  id?: string,
  name: string,
  quantity: number,
  pics?: URL[],
  weight?: number,
  price: number
}

export class Size implements ZaetabaseDocument {
  id: string;
  name: string;
  quantity: number;
  pics?: URL[];
  weight?: number;
  price: number;

  constructor(size: SizeType) {
    this.name = size.name;
    this.quantity = size.quantity;
    this.pics = size.pics;
    this.weight = size.weight;
    this.price = size.price;

    if(size.pics) {
      try {
        this.pics = typeof size.pics === 'string' ? [size.pics] : size.pics;
      } catch(e: any) {
        if (e instanceof TypeError) {
          throw new ValidationError(PICS_FIELD_NAME, PICS_FIELD_ERROR_MESSAGE);
        } else {
          throw e;
        }
      }
    }

    if (size.id) {
      if(size.id.match(ID_REGEX)) {
        this.id = size.id;
      } else {
        throw new ValidationError(ID_FIELD_NAME, ID_FIELD_ERROR_MESSAGE);
      }
    } else {
      this.id = this.generateId();
    }
  }

  generateId(): string {
      return this.name
        .toLowerCase()
        .replace(/ /gi, "-")
        .replace(NON_ID_CHARACTER_REGEX, "");
  }
}

type MerchType = {
  id?: string,
  name: string,
  description: string,
  thumbnail: URL,
  pics?: URL[],
  sizes?: Size[],
  price?: number,
  weight?: number,
  quantity?: number,
}

export default class Merch implements ZaetabaseDocument {
  id: string;
  name: string;
  description: string;
  thumbnail: URL;
  pics?: URL[];
  sizes: Size[];
  price?: number;
  weight?: number;
  quantity?: number;

  constructor(merch: MerchType) {
    this.name = merch.name;
    this.description = merch.description;
    this.price = merch.price;
    this.weight = merch.weight;
    this.quantity = merch.quantity;

    if(merch.pics) {
      try {
        this.pics = typeof merch.pics === 'string' ? [merch.pics] : merch.pics;
      } catch(e: any) {
        if (e instanceof TypeError) {
          throw new ValidationError(PICS_FIELD_NAME, PICS_FIELD_ERROR_MESSAGE);
        } else {
          throw e;
        }
      }
    }

    if(merch.sizes) {
      try {
        this.sizes = merch.sizes;
      } catch(e: any) {
        if (e instanceof ValidationError) {
          throw new ValidationError(`sizes.${e.field}`, e.message)
        } else {
          throw e;
        }
      }
    } else {
      this.sizes = []
    }

    try {
      this.thumbnail = merch.thumbnail;
    } catch (e: any) {
      if (e instanceof TypeError) {
        throw new ValidationError("thumbnail", URL_FIELD_ERROR_MESSAGE)
      } else {
        throw e;
      }
    }

    if(merch.id) {
      if (merch.id.match(ID_REGEX)) {
        this.id = merch.id;
      } else {
        throw new ValidationError(ID_FIELD_NAME, ID_FIELD_ERROR_MESSAGE);
      }
    } else {
      this.id = this.generateId();
    }
  }

  generateId(): string {
    return this.name
      .toLocaleLowerCase()
      .replace(/ /gi, "-")
      .replace(NON_ID_CHARACTER_REGEX, "");
  }
}