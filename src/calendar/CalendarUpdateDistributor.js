//@flow
import type {Recipient} from "../mail/MailEditor"
import {MailEditor} from "../mail/MailEditor"
import {lang} from "../misc/LanguageViewModel"
import {makeInvitationCalendarFile} from "./CalendarImporter"
import type {CalendarAttendeeStatusEnum, CalendarMethodEnum} from "../api/common/TutanotaConstants"
import {CalendarMethod, ConversationType, getAttendeeStatus} from "../api/common/TutanotaConstants"
import {calendarAttendeeStatusSymbol, formatEventDuration, getTimeZone} from "./CalendarUtils"
import type {CalendarEvent} from "../api/entities/tutanota/CalendarEvent"
import {MailModel} from "../mail/MailModel"
import type {MailAddress} from "../api/entities/tutanota/MailAddress"
import type {File as TutanotaFile} from "../api/entities/tutanota/File"
import {stringToUtf8Uint8Array, uint8ArrayToBase64} from "../api/common/utils/Encoding"
import {theme} from "../gui/theme"
import {assertNotNull} from "../api/common/utils/Utils"
import type {EncryptedMailAddress} from "../api/entities/tutanota/EncryptedMailAddress"
import {worker} from "../api/main/WorkerClient"
import type {RecipientInfo} from "../api/common/RecipientInfo"

export const ExternalConfidentialMode = Object.freeze({
	CONFIDENTIAL: 0,
	UNCONFIDENTIAL: 1,
})
export type ExternalConfidentialModeEnum = $Values<typeof ExternalConfidentialMode>

export interface CalendarUpdateDistributor {
	sendInvite(existingEvent: CalendarEvent, recipients: $ReadOnlyArray<Recipient>, confidentialMode: ExternalConfidentialModeEnum
	): Promise<void>;

	sendUpdate(event: CalendarEvent, recipients: $ReadOnlyArray<Recipient>, confidentialMode: ExternalConfidentialModeEnum): Promise<void>;

	sendCancellation(event: CalendarEvent, recipients: $ReadOnlyArray<Recipient>, confidentialMode: ExternalConfidentialModeEnum
	): Promise<void>;

	sendResponse(event: CalendarEvent, sender: MailAddress, status: CalendarAttendeeStatusEnum): Promise<void>;
}

export class CalendarMailDistributor implements CalendarUpdateDistributor {
	_mailModel: MailModel;

	constructor(mailModel: MailModel) {
		this._mailModel = mailModel
	}

	sendInvite(existingEvent: CalendarEvent, recipients: $ReadOnlyArray<Recipient>, confidentialMode: ExternalConfidentialModeEnum
	): Promise<void> {

		return this._mailModel.getUserMailboxDetails().then((mailboxDetails) => {
			const organizer = assertOrganizer(existingEvent)
			const subject = lang.get("eventInviteMail_msg", {"{event}": existingEvent.summary})
			const editor = new MailEditor(mailboxDetails)
			editor.initWithTemplate(
				{bcc: recipients},
				subject,
				makeInviteEmailBody(existingEvent, subject),
				/*confidential*/confidentialMode === ExternalConfidentialMode.CONFIDENTIAL,
				organizer.address,
			)
			const inviteFile = makeInvitationCalendarFile(existingEvent, CalendarMethod.REQUEST, new Date(), getTimeZone())
			sendCalendarFile(editor, inviteFile, CalendarMethod.REQUEST)
		})
	}

	sendUpdate(event: CalendarEvent, recipients: $ReadOnlyArray<Recipient>, confidentialMode: ExternalConfidentialModeEnum): Promise<void> {
		return this._mailModel.getUserMailboxDetails().then((mailboxDetails) => {
			const organizer = assertOrganizer(event)
			const editor = new MailEditor(mailboxDetails)
			editor.initWithTemplate(
				{bcc: recipients},
				lang.get("eventUpdated_msg", {"{event}": event.summary}),
				makeInviteEmailBody(event, ""),
				/*confidential*/confidentialMode === ExternalConfidentialMode.CONFIDENTIAL,
				organizer.address,
			)

			const file = makeInvitationCalendarFile(event, CalendarMethod.REQUEST, new Date(), getTimeZone())
			sendCalendarFile(editor, file, CalendarMethod.REQUEST)
		})
	}

	sendCancellation(event: CalendarEvent, recipients: $ReadOnlyArray<Recipient>,
	                 confidentialMode: ExternalConfidentialModeEnum
	): Promise<void> {
		return this._mailModel.getUserMailboxDetails().then((mailboxDetails) => {
			const organizer = assertOrganizer(event)
			const editor = new MailEditor(mailboxDetails)
			const message = lang.get("eventCancelled_msg", {"{event}": event.summary})
			editor.initWithTemplate(
				{bcc: recipients},
				message,
				makeInviteEmailBody(event, message),
				confidentialMode === ExternalConfidentialMode.CONFIDENTIAL,
				organizer.address
			)

			const file = makeInvitationCalendarFile(event, CalendarMethod.CANCEL, new Date(), getTimeZone())
			sendCalendarFile(editor, file, CalendarMethod.CANCEL)
		})
	}

	sendResponse(event: CalendarEvent, sender: MailAddress, status: CalendarAttendeeStatusEnum): Promise<void> {
		const organizer = assertOrganizer(event)
		return this._mailModel.getUserMailboxDetails().then((mailboxDetails) => {
			const editor = new MailEditor(mailboxDetails)
			const message = lang.get("repliedToEventInvite_msg", {"{sender}": sender.name || sender.address, "{event}": event.summary})
			editor.initWithTemplate(
				{to: [{name: organizer.name || "", address: organizer.address}]},
				message,
				makeResponseEmailBody(event, message, sender, status),
				// TODO
				false,
				sender.address,
			)
			const responseFile = makeInvitationCalendarFile(event, CalendarMethod.REPLY, new Date(), getTimeZone())
			sendCalendarFile(editor, responseFile, CalendarMethod.REPLY)
		})
	}
}

function sendCalendarFile(editor: MailEditor, responseFile: DataFile, method: CalendarMethodEnum) {
	editor.attachFiles([responseFile])
	editor.hooks = {
		beforeSent(editor: MailEditor, attachments: Array<TutanotaFile>) {
			return {calendarFileMethods: [[attachments[0]._id, method]]}
		}
	}
	editor.send()
}

function organizerLine(event: CalendarEvent) {
	const {organizer} = event
	// If organizer is already in the attendees, we don't have to add them separately.
	if (organizer && event.attendees.find((a) => a.address.address === organizer.address)) {
		return ""
	}
	return `<div style="display: flex"><div style="min-width: 80px">${lang.get("who_label")}:</div><div>${
		organizer ? `${organizer.name || ""} ${organizer.address} </EXTERNAL_FRAGMENT> (${lang.get("organizer_label")})` : ""}</div></div>`
}

function whenLine(event: CalendarEvent): string {
	const duration = formatEventDuration(event, getTimeZone())
	return `<div style="display: flex"><div style="min-width: 80px">${lang.get("when_label")}:</div>${duration}</div>`
}

function organizerLabel(event, a) {
	return assertNotNull(event.organizer) === a.address.address ? `(${lang.get("organizer_label")})` : ""
}

function makeInviteEmailBody(event: CalendarEvent, message: string) {
	return `<div style="max-width: 685px; margin: 0 auto">
  <h2 style="text-align: center">${message}</h2>
  <div style="margin: 0 auto">
    ${whenLine(event)}
    ${organizerLine(event)}
    ${event.attendees.map((a) =>
		`<div style='margin-left: 80px'>
${a.address.name || ""} ${a.address.address}
${(organizerLabel(event, a))}
${calendarAttendeeStatusSymbol(getAttendeeStatus(a))}</div>`)
	       .join("\n")}
  </div>
  <hr style="border: 0; height: 1px; background-color: #ddd">
  <img style="max-height: 38px; display: block; background-color: white; padding: 4px 8px; border-radius: 4px; margin: 16px auto 0"
  		src="data:image/svg+xml;base64,${uint8ArrayToBase64(stringToUtf8Uint8Array(theme.logo))}"
  		alt="logo"/>
</div>`
}

function makeResponseEmailBody(event: CalendarEvent, message: string, sender: MailAddress, status: CalendarAttendeeStatusEnum): string {
	return `<div style="max-width: 685px; margin: 0 auto">
  <h2 style="text-align: center">${message}</h2>
  <div style="margin: 0 auto">
  <div style="display: flex">${lang.get("who_label")}:<div style='margin-left: 80px'>${sender.name + " " + sender.address
	} ${calendarAttendeeStatusSymbol(status)}</div></div>
  </div>
  <hr style="border: 0; height: 1px; background-color: #ddd">
  <img style="max-height: 38px; display: block; background-color: white; padding: 4px 8px; border-radius: 4px; margin: 16px auto 0"
  		src="data:image/svg+xml;base64,${uint8ArrayToBase64(stringToUtf8Uint8Array(theme.logo))}"
  		alt="logo"/>
</div>`
}

function assertOrganizer(event: CalendarEvent): EncryptedMailAddress {
	if (event.organizer == null) {
		throw new Error("Cannot send event update without organizer")
	}
	return event.organizer
}