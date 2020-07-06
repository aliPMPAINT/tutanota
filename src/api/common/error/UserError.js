//@flow
import {TutanotaError} from "./TutanotaError"
import type {TranslationKeyType} from "../../../misc/TranslationKey"
import {assertMainOrNode} from "../../Env"

assertMainOrNode()

export class UserError extends TutanotaError {
	+msgKey: TranslationKeyType

	constructor(msgKey: TranslationKeyType) {
		super("UserError", msgKey)
		this.msgKey = msgKey
	}
}