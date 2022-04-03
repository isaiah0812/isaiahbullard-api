import { ZaetabaseDocument } from ".";
import { ID_REGEX, NON_ID_CHARACTER_REGEX } from "../utils/helpers";
import { COVER_FIELD_NAME, DATE_FIELD_ERROR_MESSAGE, ID_FIELD_ERROR_MESSAGE, ID_FIELD_NAME, RELEASE_DATE_FIELD_NAME, URL_FIELD_ERROR_MESSAGE, ValidationError } from "./errorHandling";

type SingleType = {
  id?: string;
  title: string;
  description: string;
  cover: URL;
  color: string;
  features?: string[];
  releaseDate: Date;
  spotify: string;
  apple: string;
  bandcamp: string;
  soundcloud: string;
  songLink: string;
}

export class Single implements ZaetabaseDocument {
  id: string;
  title: string;
  description: string;
  cover: URL;
  color: string;
  features?: string[];
  releaseDate: Date;
  spotify: string;
  apple: string;
  bandcamp: string;
  soundcloud: string;
  songLink: string;

  constructor(single: SingleType) {
    this.title = single.title;
    this.description = single.description;
    this.color = single.color;
    this.spotify = single.spotify;
    this.apple = single.apple;
    this.bandcamp = single.bandcamp;
    this.soundcloud = single.soundcloud;
    this.songLink = single.songLink;

    if (typeof single.features === 'string') {
      this.features = [single.features]
    } else {
      this.features = single.features;
    }

    try {
      this.cover = new URL(single.cover);
    } catch (e: any) {
      if (e instanceof TypeError) {
        throw new ValidationError(COVER_FIELD_NAME, URL_FIELD_ERROR_MESSAGE);
      } else {
        throw e;
      }
    }

    const rd = new Date(single.releaseDate);

    if (rd instanceof Date 
      && rd.toString() !== "Invalid Date") {
      this.releaseDate = rd;
    } else {
      throw new ValidationError(RELEASE_DATE_FIELD_NAME, DATE_FIELD_ERROR_MESSAGE);
    }

    if (single.id) {
      if (single.id.match(ID_REGEX)) {
        this.id = single.id;
      } else {
        throw new ValidationError(ID_FIELD_NAME, ID_FIELD_ERROR_MESSAGE);
      }
    } else {
      this.id = this.generateId();
    }
  }

  generateId(): string {
      return this.title
        .toLowerCase()
        .replace(/ /gi, "-")
        .replace(NON_ID_CHARACTER_REGEX, "");
  }
}
