import { ZaetabaseDocument } from ".";
import { KeySignatures } from "../utils/enums";
import { ID_REGEX, NON_ID_CHARACTER_REGEX } from "../utils/helpers";
import { COVER_FIELD_NAME, ID_FIELD_ERROR_MESSAGE, ID_FIELD_NAME, URL_FIELD_ERROR_MESSAGE, ValidationError } from "./errorHandling";

type BeatType = {
  id?: string;
  title: string;
  cover?: URL;
  youtube: string;
  keySignature: KeySignatures;
  tempo: number;
  sold: boolean;
}

export default class Beat implements ZaetabaseDocument {
  id: string;
  title: string;
  cover?: URL;
  youtube: string;
  keySignature: KeySignatures;
  tempo: number;
  sold: boolean;

  constructor(beat: BeatType) {
    this.title = beat.title;
    this.youtube = beat.youtube;
    this.tempo = beat.tempo;
    this.sold = beat.sold || false;

    if (Object.values(KeySignatures).includes(beat.keySignature)) {
      this.keySignature = beat.keySignature;
    } else {
      throw new ValidationError("keySignature", "Field must be a valid KeySignature");
    }

    if (beat.cover) {
      try {
        this.cover = new URL(beat.cover);
      } catch (e: any) {
        if (e instanceof TypeError) {
          throw new ValidationError(COVER_FIELD_NAME, URL_FIELD_ERROR_MESSAGE);
        } else {
          throw e;
        }
      }
    }

    if (beat.id) {
      if (beat.id.match(ID_REGEX)) {
        this.id = beat.id;
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
