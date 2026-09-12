use std::ffi::c_uint;

use napi::{Error, Status};

use crate::api::LibVlcApi;
use crate::ffi::LibvlcMediaPlayer;
use crate::platform::read_handle;
use crate::util::to_napi_error;

pub unsafe fn apply_output_window(
  api: &LibVlcApi,
  player: *mut LibvlcMediaPlayer,
  handle: &[u8],
) -> napi::Result<()> {
  let native_window = usize::from_ne_bytes(read_handle(handle, "XWindow")?);
  if native_window == 0 {
    return Err(Error::new(
      Status::InvalidArg,
      "window handle must not be zero".to_string(),
    ));
  }
  let raw = u32::try_from(native_window).map_err(|_| {
    Error::new(
      Status::InvalidArg,
      "XWindow handle exceeds libVLC's uint32 range".to_string(),
    )
  })?;

  match api.libvlc_media_player_set_xwindow {
    Some(setter) => setter(player, raw as c_uint),
    None => {
      return Err(to_napi_error(
        "libVLC does not expose xwindow setter; X11 or XWayland output is required",
      ))
    }
  }

  Ok(())
}
