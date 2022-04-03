import { ZaetabaseDocument } from ".";
import { ID_REGEX, NON_ID_CHARACTER_REGEX } from "../utils/helpers";
import { ID_FIELD_ERROR_MESSAGE, ID_FIELD_NAME, ValidationError } from "./errorHandling";

type VideoType = {
  id?: string;
  title: string;
  youtube: string;
}

export class Video implements ZaetabaseDocument {
  id: string;
  title: string;
  youtube: string;

  constructor(video: VideoType) {
    this.title = video.title;
    this.youtube = video.youtube;

    if (video.id) {
      if (video.id.match(ID_REGEX)) {
        this.id = video.id;
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
