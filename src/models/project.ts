import { ZaetabaseDocument } from ".";
import { ID_REGEX, isInvalidNonEmptyString, NON_ID_CHARACTER_REGEX } from "../utils/helpers";
import Beat from "./beat";
import { 
  ARRAY_REQUIRED_MESSAGE,
  COVER_FIELD_NAME,
  DATE_FIELD_ERROR_MESSAGE,
  ID_FIELD_ERROR_MESSAGE,
  ID_FIELD_NAME,
  RELEASE_DATE_FIELD_NAME,
  STRING_NOT_EMPTY_MESSAGE,
  TITLE_FIELD_NAME,
  URL_FIELD_ERROR_MESSAGE,
  ValidationError
} from "./errorHandling";

type PersonType = {
  name: string;
  username?: string;
  instagram?: boolean;
}

export class Person {
  name: string;
  username?: string;
  instagram?: boolean;

  constructor(person: PersonType) {
    if(isInvalidNonEmptyString(person.name)) {
      throw new ValidationError("name", STRING_NOT_EMPTY_MESSAGE);
    }

    if(person.username !== undefined && person.instagram === undefined) {
      throw new ValidationError("instagram", "Field must be included when passing the 'username' field");
    }
    
    this.name = person.name;
    this.username = person.username;
    this.instagram = person.instagram;
  }
}

type ProjectCreditType = {
  features: PersonType[];
  producedBy: PersonType[];
  mixedBy: PersonType[];
  masteredBy: PersonType[];
  artworkBy: PersonType[];
  specialThanks?: PersonType[];
}

type AlbumCreditType = ProjectCreditType & {
  songwriters: string[];
}

type BeatTapeCreditType = ProjectCreditType & {
  samples?: string[];
}

export class ProjectCredit {
  features: Person[];
  producedBy: Person[];
  mixedBy: Person[];
  masteredBy: Person[];
  artworkBy: Person[];
  specialThanks?: Person[];

  constructor(projectCredit: ProjectCreditType) {
    try {
      this.features = [];

      for(const feature of projectCredit.features) {
        this.features.push(new Person(feature));
      }
    } catch(e: any) {
      if (e instanceof ValidationError) {
        if(e.field !== "features") {
          throw new ValidationError(`features.${e.field}`, e.message);
        }

        throw e;
      } else if (e instanceof TypeError) {
        throw new ValidationError("features", ARRAY_REQUIRED_MESSAGE);
      } else {
        throw e;
      }
    }

    try {
      this.producedBy = [];
      
      for (const producer of projectCredit.producedBy) {
        this.producedBy.push(new Person(producer));
      }
    } catch(e: any) {
      if (e instanceof ValidationError) {
        throw new ValidationError(`producedBy.${e.field}`, e.message);
      } else if (e instanceof TypeError) {
        throw new ValidationError("producedBy", ARRAY_REQUIRED_MESSAGE);
      } else {
        throw e;
      }
    }

    try {
      this.mixedBy = [];

      for (const mixer of projectCredit.mixedBy) {
        this.mixedBy.push(new Person(mixer));
      }
    } catch(e: any) {
      if (e instanceof ValidationError) {
        throw new ValidationError(`mixedBy.${e.field}`, e.message);
      } else if (e instanceof TypeError) {
        throw new ValidationError("mixedBy", ARRAY_REQUIRED_MESSAGE);
      } else {
        throw e;
      }
    }

    try {
      this.masteredBy = [];

      for (const engineer of projectCredit.masteredBy) {
        this.mixedBy.push(new Person(engineer));
      }
    } catch(e: any) {
      if (e instanceof ValidationError) {
        throw new ValidationError(`masteredBy.${e.field}`, e.message);
      } else if (e instanceof TypeError) {
        throw new ValidationError("masteredBy", ARRAY_REQUIRED_MESSAGE);
      } else {
        throw e;
      }
    }

    try {
      this.artworkBy = [];

      for (const artist of projectCredit.artworkBy) {
        this.artworkBy.push(new Person(artist));
      }
    } catch(e: any) {
      if (e instanceof ValidationError) {
        throw new ValidationError(`artworkBy.${e.field}`, e.message);
      } else if (e instanceof TypeError) {
        throw new ValidationError("artworkBy", ARRAY_REQUIRED_MESSAGE);
      } else {
        throw e;
      }
    }

    if (projectCredit.specialThanks) {
      try {
        this.specialThanks = [];

        for (const credit of projectCredit.specialThanks) {
          this.specialThanks.push(new Person(credit));
        }
      } catch(e: any) {
        if (e instanceof ValidationError) {
          throw new ValidationError(`specialThanks.${e.field}`, e.message);
        } else if (e instanceof TypeError) {
          throw new ValidationError("specialThanks", `When present, ${ARRAY_REQUIRED_MESSAGE}`);
        } else {
          throw e;
        }
      }
    }
  }
}

export class AlbumCredits extends ProjectCredit {
  songwriters: string[];

  constructor(albumCredit: AlbumCreditType) {
    super(albumCredit);

    try {
      this.songwriters = [];

      for (const writer of albumCredit.songwriters) {
        this.songwriters.push(writer);
      }
    } catch(e: any) {
      if (e instanceof TypeError) {
        throw new ValidationError("songwriters", ARRAY_REQUIRED_MESSAGE);
      } else {
        throw e;
      }
    }
  }
}

export class BeatTapeCredits extends ProjectCredit {
  samples?: string[];

  constructor(beatTapeCredit: BeatTapeCreditType) {
    super(beatTapeCredit);

    if (beatTapeCredit.samples) {
      try {
        this.samples = [];

        for (const credit of beatTapeCredit.samples) {
          this.samples.push(credit);
        }
      } catch(e: any) {
        if (e instanceof TypeError) {
          throw new ValidationError("samples", `When present, ${ARRAY_REQUIRED_MESSAGE}`);
        } else {
          throw e;
        }
      }
    }
  }
}

export type ProjectType = {
  id?: string;
  title: string;
  cover: URL;
  releaseDate: Date;
  songList: string[];
  description: URL | string;
  bandcamp: string;
  soundCloud: string;
}

export type AlbumType = ProjectType & {
  albumCredits: AlbumCreditType;
  spotify: string;
  apple: string;
  songLink: string;
}

export type BeatTapeType = ProjectType & {
  albumCredits: BeatTapeCreditType;
  youTube: string;
  beats: Beat[]
}

// TODO: Add that error haandling for the custom types like in merch.ts
export class Project implements ZaetabaseDocument {
  id: string;
  title: string;
  cover: URL;
  releaseDate: Date;
  songList: string[];
  description: URL | string;
  bandcamp: string;
  soundCloud: string;
  beatTape: boolean = false;

  constructor(project: ProjectType) {
    try {
      this.cover = new URL(project.cover);
    } catch (e: any) {
      if (e instanceof TypeError) {
        throw new ValidationError(COVER_FIELD_NAME, URL_FIELD_ERROR_MESSAGE);
      } else {
        throw e;
      }
    }
    
    const rd = new Date(project.releaseDate);
    
    if (rd instanceof Date 
      && rd.toString() !== "Invalid Date") {
      this.releaseDate = rd;
    } else {
      throw new ValidationError(RELEASE_DATE_FIELD_NAME, DATE_FIELD_ERROR_MESSAGE);
    }
    
    try {
      this.description = new URL(project.description);
    } catch (e: any) {
      if (e instanceof TypeError) {
        if (typeof project.description !== "string" || isInvalidNonEmptyString(project.title)) {
          throw new ValidationError("description", "Field must be a valid URL string or a non-empty string.");
        }

        this.description = project.description;
      } else {
        throw new ValidationError("description", "Field must be a valid URL string or a non-empty string.");
      }
    }
    
    if (isInvalidNonEmptyString(project.title)) {
      throw new ValidationError(TITLE_FIELD_NAME, STRING_NOT_EMPTY_MESSAGE);
    }
    this.title = project.title;

    this.songList = [];
    for(const song of project.songList) {
      if (isInvalidNonEmptyString(song)) {
        throw new ValidationError("songList", "Items in field must be non-empty strings");
      }
      
      this.songList.push(song);
    }
    
    if (isInvalidNonEmptyString(project.bandcamp)) {
      throw new ValidationError("bandcamp", STRING_NOT_EMPTY_MESSAGE);
    }
    this.bandcamp = project.bandcamp;

    if (isInvalidNonEmptyString(project.soundCloud)) {
      throw new ValidationError("soundCloud", STRING_NOT_EMPTY_MESSAGE);
    }
    this.soundCloud = project.soundCloud;

    if (project.id) {
      if (project.id.match(ID_REGEX)) {
        this.id = project.id;
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

export class Album extends Project {
  albumCredits: AlbumCredits;
  spotify: string;
  apple: string;
  songLink: string;

  constructor(album: AlbumType) {
    super(album);

    try {
      this.albumCredits = new AlbumCredits(album.albumCredits);
    } catch(e: any) {
      if (e instanceof ValidationError) {
        throw new ValidationError(`albumCredits.${e.field}`, e.message);
      } else {
        throw e
      }
    }

    if (isInvalidNonEmptyString(album.spotify)) {
      throw new ValidationError("spotify", STRING_NOT_EMPTY_MESSAGE);
    }
    this.spotify = album.spotify;

    if (isInvalidNonEmptyString(album.apple)) {
      throw new ValidationError("apple", STRING_NOT_EMPTY_MESSAGE);
    }
    this.apple = album.apple;

    if (isInvalidNonEmptyString(album.songLink)) {
      throw new ValidationError("songLink", STRING_NOT_EMPTY_MESSAGE);
    }
    this.songLink = album.songLink;

    this.beatTape = false;
  }
}

export class BeatTape extends Project {
  albumCredits: BeatTapeCredits;
  youTube: string;
  beats: Beat[];

  constructor(beatTape: BeatTapeType) {
    super(beatTape);

    try {
      this.albumCredits = new BeatTapeCredits(beatTape.albumCredits);
    } catch(e: any) {
      if (e instanceof ValidationError) {
        throw new ValidationError(`albumCredits.${e.field}`, e.message)
      } else {
        throw e;
      }
    }

    try {
      this.beats = beatTape.beats;
    } catch(e: any) {
      if (e instanceof ValidationError) {
        throw new ValidationError(`beats.${e.field}`, e.message)
      } else {
        throw e;
      }
    }
    
    this.albumCredits = beatTape.albumCredits;

    if (isInvalidNonEmptyString(beatTape.youTube)) {
      throw new ValidationError("youTube", STRING_NOT_EMPTY_MESSAGE);
    }
    this.youTube = beatTape.youTube;
    this.beatTape = true;
  }
}
