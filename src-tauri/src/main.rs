// Hide the extra Windows console in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() { charpet_lib::run(); }
