import { ZaetabaseDocument } from ".";
import { ID_REGEX, NON_ID_CHARACTER_REGEX } from "../utils/helpers";
import { ID_FIELD_ERROR_MESSAGE, ID_FIELD_NAME, URL_FIELD_ERROR_MESSAGE, ValidationError } from "./errorHandling";

type CreditType = {
  id?: string,
  title: string,
  artist: string,
  link: URL
}

export default class Credit implements ZaetabaseDocument {
  id: string;
  title: string;
  artist: string;
  link: URL;

  constructor(credit: CreditType) {
    this.title = credit.title;
    this.artist = credit.artist;
    this.link = credit.link;

    try {
      this.link = new URL(credit.link);
    } catch (e: any) {
      if(e instanceof TypeError) {
        throw new ValidationError("link", URL_FIELD_ERROR_MESSAGE);
      } else {
        throw e;
      }
    }

    if (credit.id) {
      if (credit.id.match(ID_REGEX)) {
        this.id = credit.id;
      } else {
        throw new ValidationError(ID_FIELD_NAME, ID_FIELD_ERROR_MESSAGE)
      }
    } else {
      this.id = this.generateId();
    }
  }

  generateId(): string {
      return this.idify(this.title) + '-' + this.idify(this.artist)
  }

  idify(text: string) {
    return text.toLocaleLowerCase().replace(/ /gi, "").replace(NON_ID_CHARACTER_REGEX, "");
  }
}
