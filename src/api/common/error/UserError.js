//@flow
import {TutanotaError} from "./TutanotaError"

export class UserError extends TutanotaError {
	constructor(message: string) {
		super("UserError", message)
	}
}