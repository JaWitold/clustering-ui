version v1

# how many free changes we keep in reserve
const reserve = 2

# keep the reserve
#   (two lines, the second one indented)
if free_price_changes() <= reserve then
    # nothing to do
    return stay
end

# default
return cut::proportional, hike::proportional
