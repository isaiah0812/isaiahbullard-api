import { ZaetabaseDocument } from ".";
import { ID_REGEX, NON_ID_CHARACTER_REGEX } from "../utils/helpers";
import Beat from "./beat";
import { COVER_FIELD_NAME, DATE_FIELD_ERROR_MESSAGE, ID_FIELD_ERROR_MESSAGE, ID_FIELD_NAME, RELEASE_DATE_FIELD_NAME, URL_FIELD_ERROR_MESSAGE, ValidationError } from "./errorHandling";

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
    if(person.username !== undefined && person.instagram === undefined) {
      throw new ValidationError("instagram", "Field must be included when passing the 'username' field")
    }
    
    this.name = person.name;
    this.username = person.username;
    this.instagram = person.instagram;
  }
}

type ProjectCreditType = {
  albumId: string;
  features: Person[];
  producedBy: Person[];
  mixedBy: Person[];
  masteredBy: Person[];
  artworkBy: Person[];
  specialThanks?: Person[];
}

type AlbumCreditType = ProjectCreditType & {
  songwriters: string[];
}

type BeatTapeCreditType = ProjectCreditType & {
  samples?: string[];
}

export class ProjectCredit {
  albumId: string;
  features: Person[];
  producedBy: Person[];
  mixedBy: Person[];
  masteredBy: Person[];
  artworkBy: Person[];
  specialThanks?: Person[];

  constructor(projectCredit: ProjectCreditType) {
    try {
      this.features = projectCredit.features;
    } catch(e: any) {
      if (e instanceof ValidationError) {
        throw new ValidationError(`features.${e.field}`, e.message);
      } else {
        throw e;
      }
    }

    try {
      this.producedBy = projectCredit.producedBy;
    } catch(e: any) {
      if (e instanceof ValidationError) {
        throw new ValidationError(`producedBy.${e.field}`, e.message);
      } else {
        throw e;
      }
    }

    try {
      this.mixedBy = projectCredit.mixedBy;
    } catch(e: any) {
      if (e instanceof ValidationError) {
        throw new ValidationError(`mixedBy.${e.field}`, e.message);
      } else {
        throw e;
      }
    }

    try {
      this.masteredBy = projectCredit.masteredBy;
    } catch(e: any) {
      if (e instanceof ValidationError) {
        throw new ValidationError(`masteredBy.${e.field}`, e.message);
      } else {
        throw e;
      }
    }

    try {
      this.artworkBy = projectCredit.artworkBy;
    } catch(e: any) {
      if (e instanceof ValidationError) {
        throw new ValidationError(`artworkBy.${e.field}`, e.message);
      } else {
        throw e;
      }
    }

    if (projectCredit.specialThanks) {
      try {
        this.specialThanks = projectCredit.specialThanks;
      } catch(e: any) {
        if (e instanceof ValidationError) {
          throw new ValidationError(`specialThanks.${e.field}`, e.message);
        } else {
          throw e;
        }
      }
    }

    this.albumId = projectCredit.albumId;
  }
}

export class AlbumCredits extends ProjectCredit {
  songwriters: string[];

  constructor(albumCredit: AlbumCreditType) {
    super(albumCredit);

    this.songwriters = albumCredit.songwriters;
  }
}

export class BeatTapeCredits extends ProjectCredit {
  samples?: string[];

  constructor(beatTapeCredit: BeatTapeCreditType) {
    super(beatTapeCredit);

    this.samples = beatTapeCredit.samples;
  }
}

type ProjectType = {
  id?: string;
  title: string;
  cover: URL;
  releaseDate: Date;
  songList: string[];
  description: URL | string;
  bandcamp: string;
  soundCloud: string;
}

type AlbumType = ProjectType & {
  albumCredits: AlbumCredits;
  spotify: string;
  apple: string;
  songLink: string;
}

type BeatTapeType = ProjectType & {
  albumCredits: BeatTapeCredits;
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
          this.description = project.description;
        } else {
          throw e;
        }
      }
      
    this.title = project.title;
    this.songList = project.songList;
    this.description = project.description;
    this.bandcamp = project.bandcamp;
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
      this.albumCredits = album.albumCredits;
    } catch(e: any) {
      if (e instanceof ValidationError) {
        throw new ValidationError(`albumCredits.${e.field}`, e.message);
      } else {
        throw e
      }
    }

    this.spotify = album.spotify;
    this.apple = album.apple;
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
      this.albumCredits = beatTape.albumCredits;
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
    this.youTube = beatTape.youTube;
    this.beatTape = true;
  }
}
