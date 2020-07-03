//@flow
import {lang} from "../misc/LanguageViewModel"
import {makeInvitationCalendarFile} from "./CalendarImporter"
import type {CalendarAttendeeStatusEnum, CalendarMethodEnum} from "../api/common/TutanotaConstants"
import {CalendarMethod, getAttendeeStatus} from "../api/common/TutanotaConstants"
import {calendarAttendeeStatusSymbol, formatEventDuration, getTimeZone} from "./CalendarUtils"
import type {CalendarEvent} from "../api/entities/tutanota/CalendarEvent"
import type {MailAddress} from "../api/entities/tutanota/MailAddress"
import {stringToUtf8Uint8Array, uint8ArrayToBase64} from "../api/common/utils/Encoding"
import {theme} from "../gui/theme"
import {assertNotNull} from "../api/common/utils/Utils"
import type {EncryptedMailAddress} from "../api/entities/tutanota/EncryptedMailAddress"
import {SendMailModel} from "../mail/SendMailModel"
import {show} from "../gui/base/NotificationOverlay"
import m from "mithril"

export const ExternalConfidentialMode = Object.freeze({
	CONFIDENTIAL: 0,
	UNCONFIDENTIAL: 1,
})
export type ExternalConfidentialModeEnum = $Values<typeof ExternalConfidentialMode>

export interface CalendarUpdateDistributor {
	sendInvite(existingEvent: CalendarEvent, sendMailModel: SendMailModel): Promise<void>;

	sendUpdate(event: CalendarEvent, sendMailModel: SendMailModel): Promise<void>;

	sendCancellation(event: CalendarEvent, sendMailModel: SendMailModel): Promise<void>;

	sendResponse(event: CalendarEvent, sendMailModel: SendMailModel, status: CalendarAttendeeStatusEnum): Promise<void>;
}

export class CalendarMailDistributor implements CalendarUpdateDistributor {
	sendInvite(event: CalendarEvent, sendMailModel: SendMailModel): Promise<void> {
		const message = lang.get("eventInviteMail_msg", {"{event}": event.summary})
		return sendCalendarFile({
			sendMailModel,
			method: CalendarMethod.REQUEST,
			subject: message,
			body: makeInviteEmailBody(event, message),
			event,
		})
	}

	sendUpdate(event: CalendarEvent, sendMailModel: SendMailModel): Promise<void> {
		return sendCalendarFile({
			sendMailModel,
			method: CalendarMethod.REQUEST,
			subject: lang.get("eventUpdated_msg", {"{event}": event.summary}),
			body: makeInviteEmailBody(event, ""),
			event,
		}).then(() => {
			const closeSent = show({view: () => m("", lang.get("updateSent_msg"))}, {}, [])
			setTimeout(closeSent, 3000)
		})
	}

	sendCancellation(event: CalendarEvent, sendMailModel: SendMailModel): Promise<void> {
		const message = lang.get("eventCancelled_msg", {"{event}": event.summary})
		return sendCalendarFile({
			sendMailModel,
			method: CalendarMethod.CANCEL,
			subject: message,
			body: makeInviteEmailBody(event, message),
			event,
		})
	}

	sendResponse(event: CalendarEvent, sendMailModel: SendMailModel, status: CalendarAttendeeStatusEnum): Promise<void> {
		const message = lang.get("repliedToEventInvite_msg", {"{sender}": sendMailModel._senderAddress, "{event}": event.summary})
		return sendCalendarFile({
			sendMailModel,
			method: CalendarMethod.REPLY,
			subject: message,
			body: makeInviteEmailBody(event, message),
			event,
		})
	}
}

function sendCalendarFile({sendMailModel, method, subject, event, body}: {
	sendMailModel: SendMailModel,
	method: CalendarMethodEnum,
	subject: string,
	event: CalendarEvent,
	body: string,
}): Promise<void> {
	const organizer = assertOrganizer(event)
	const inviteFile = makeInvitationCalendarFile(event, method, new Date(), getTimeZone())
	sendMailModel.selectSender(organizer.address)
	if (sendMailModel.attachFiles([inviteFile]).length) {
		throw new Error("Invite file is too big?")
	}
	sendMailModel.setSubject(subject)
	return sendMailModel.send(body)
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